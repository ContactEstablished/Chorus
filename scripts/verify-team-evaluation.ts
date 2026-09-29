// Measured native interactive lead-only/Team execution. Never opens the installed app DB.
import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { StorageService } from '../src/main/services/storage'
import { SessionManager } from '../src/main/services/sessionManager'
import { CredentialVault } from '../src/main/services/vault'
import { GitWorktreeManager } from '../src/main/services/worktrees'
import { TeamRuntime } from '../src/main/services/teamRuntime'
import { windowsHelperPlatform } from '../src/main/services/helperProcess'
import type { TeamSnapshot } from '../src/shared/team'
import { copyFixtureCredential } from './team-fixture-credential'
// The installed xterm parser works without opening a DOM view. Interpret the actual terminal
// screen instead of treating cursor-motion redraws as append-only approval text.
;(globalThis as any).self = globalThis
const { Terminal } = require('@xterm/xterm') as typeof import('@xterm/xterm')
const evidence = process.env.CHORUS_EVALUATION_EVIDENCE!
const plan = JSON.parse(fs.readFileSync(path.join(evidence, 'plan.json'), 'utf8'))
app.setPath('userData', path.join(evidence, 'profile'))
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const write = (name: string, value: unknown) => fs.writeFileSync(path.join(evidence, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2))
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true }).trim()
const hash = (file: string) => createHash('sha256').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex')
type Identity = { pid: number; creationTime: string; executable: string }
app.whenReady().then(async () => {
  const source = path.join(evidence, 'source')
  execFileSync('git', ['clone', '--quiet', '--no-hardlinks', plan.frozenSource, source], { windowsHide: true })
  const storage = new StorageService(path.join(evidence, 'fixture.db')), sessions = new SessionManager()
  sessions.bindStorage(storage); sessions.bindInstructionsDir(path.join(evidence, 'instructions'))
  sessions.onExit((id, code) => storage.updateSessionStatus(id, 'exited', code))
  const runtime = new TeamRuntime({ storage, sessions, vault: new CredentialVault(storage), worktrees: new GitWorktreeManager(storage), configDirectory: path.join(evidence, 'config'), bridgeScript: path.resolve(process.env.CHORUS_EVALUATION_BRIDGE ?? 'resources/teamBridge.cjs'), memory: async () => ({ servers: [] }) })
  const nativeNode = execFileSync('where.exe', ['node.exe'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)[0]
  let runId: string | null = null, sessionId = '', cwd = source, terminal = '', submittedAt = 0, finishedAt = 0
  let lastSnapshot: TeamSnapshot | undefined, owned: Identity[] = [], pollInFlight = false
  let ownershipTimer: ReturnType<typeof setInterval> | undefined
  const screen = new Terminal({ cols: 120, rows: 40, scrollback: 1000, allowProposedApi: true })
  const screenText = () => Array.from({ length: screen.rows }, (_, i) => screen.buffer.active.getLine(screen.buffer.active.baseY + i)?.translateToString(true) ?? '').join('\n')
  const interventions: unknown[] = []
  const record: Record<string, unknown> = { schemaVersion: 1, fixture: plan.fixture.id, pair: plan.pair, condition: plan.condition, order: plan.order, baseSha: plan.baseSha, deadlineMs: plan.deadlineMs, lead: { harness: 'claude', model: 'sonnet', effort: null, authMode: 'subscription' }, roster: plan.roster, evidence, passed: false, humanInteractionMs: null, subscriptionBilledUsd: null }
  const transcript = () => {
    const row = storage.getSessionById(sessionId)
    if (!row?.agentSessionId) return []
    const file = path.join(os.homedir(), '.claude', 'projects', path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-'), `${row.agentSessionId}.jsonl`)
    if (!fs.existsSync(file)) return []
    if (fs.statSync(file).size > 64 * 1024 * 1024) throw Error('Evaluation transcript exceeded its bounded reader')
    return fs.readFileSync(file, 'utf8').split('\n').flatMap(line => { try { const row = JSON.parse(line); return row.sessionId === storage.getSessionById(sessionId)?.agentSessionId ? [row] : [] } catch { return [] } })
  }
  try {
    await runtime.start()
    const selectedFixtureCredential = process.env.CHORUS_TEAM_FIXTURE_CREDENTIAL_SOURCE ? copyFixtureCredential(process.env.CHORUS_TEAM_FIXTURE_CREDENTIAL_SOURCE, storage) : null
    const { project } = storage.getOrCreateProject(source), caps = await runtime.capabilities()
    const lead = caps.options.find(o => o.key === 'claude' && o.enabled)
    if (!lead) throw Error('The frozen Claude lead combination is unavailable')
    record.lead = { ...record.lead as object, installedVersion: lead.member.installedVersion }
    sessions.onData((id, text) => { if (id === sessionId || (runId && id === runtime.teams.getRun(runId).leadSessionId)) { screen.write(text); terminal += text; if (terminal.length > 4 * 1024 * 1024) terminal = terminal.slice(-4 * 1024 * 1024); write('terminal.log', terminal) } })
    if (plan.condition === 'team') {
      const helpers = plan.roster.map((key: string) => { const option = caps.options.find(o => o.key === (key === 'opencode-api' ? selectedFixtureCredential : key) && o.enabled); if (!option) throw Error(`Frozen helper unavailable: ${key}`); return { ...option.member, id: randomUUID() } })
      const config = { schemaVersion: 1, baseRevision: plan.baseSha, lead: { ...lead.member, id: randomUUID() }, helpers, concurrency: 2, executionMinutes: 5, integrationPolicy: 'lead-integrates' }
      const ack = await runtime.service.createRun({ projectId: project.id, clientRequestId: 'evaluation-launch', config }, { role: 'user', principal: 'evaluation-controller' })
      runId = String(ack.runId); record.runId = runId; record.config = config
    } else {
      sessionId = randomUUID()
      cwd = path.join(evidence, 'lead-workspace')
      execFileSync('git', ['-C', source, 'worktree', 'add', '--quiet', '-b', 'evaluation-lead', cwd, plan.baseSha], { windowsHide: true })
      storage.createSession({ id: sessionId, projectId: project.id, agent: 'claude', cwd, status: 'exited', createdAt: new Date().toISOString(), name: 'Evaluation lead' })
      sessions.launch('claude', cwd, sessionId, { permissionMode: 'manual', requireInstructions: true, disableResumeFallback: true, forceFreshConversation: true, instructions: 'This is a disposable, bounded software evaluation. Work only in this workspace. Do not use native subagents or nested CLIs. Preserve acceptance tests and all files outside the explicitly editable manifest. Git inspection, committing only your implementation, and node --test are authorized here.', teamLaunchArgs: ['--model', 'sonnet', '--disallowedTools', 'Agent,Task'], envAdditions: { DISABLE_AUTOUPDATER: '1', PATHEXT: '.COM;.EXE;.BAT;.CMD' } })
      storage.updateSessionStatus(sessionId, 'running', null)
      const pid = sessions.ownedPtyPid(sessionId); if (!pid) throw Error('Baseline lead PID missing')
      owned = (await windowsHelperPlatform.inspect(pid, [])).identities
      if (!owned.length) throw Error('Baseline lead process ownership unavailable')
      write('owned-processes.json', owned)
      ownershipTimer = setInterval(() => { if (pollInFlight) return; pollInFlight = true; void windowsHelperPlatform.inspect(pid, owned).then(observed => {
        if (observed.uncertain) throw Error('Baseline process identity became uncertain')
        const next=[owned[0],...observed.identities.filter(p=>p.pid!==pid)],retired=owned.filter(p=>!next.some(live=>live.pid===p.pid&&live.creationTime===p.creationTime))
        fs.appendFileSync(path.join(evidence,'process-observations.jsonl'),JSON.stringify({at:new Date().toISOString(),identities:next,retired})+'\n')
        owned=next;write('owned-processes.json', owned)
      }).catch(error => write('ownership-error.json', { message: error.message })).finally(() => { pollInFlight = false }) }, 2500)
    }
    let trustSent = false, permissionSignature = '', permissionAt = 0, resized = false
    const launchDeadline = Date.now() + 90000
    const ready = async () => {
      if (runId) {
        lastSnapshot = runtime.service.getSnapshot(runId); write('snapshot.json', lastSnapshot)
        sessionId = lastSnapshot.run.leadSessionId ?? ''
        if (sessionId && !resized) { sessions.resize(sessionId, 120, 40); resized = true }
        if (lastSnapshot.run.integrationWorktreeId) cwd = storage.getWorktreeById(lastSnapshot.run.integrationWorktreeId)!.path
        if (lastSnapshot.run.status === 'blocked') throw Error(lastSnapshot.run.blocker ?? 'Team blocked')
        return lastSnapshot.run.status === 'active'
      }
      // The scrollback retains the earlier trust screen after acceptance. Inspect the current prompt tail.
      if (sessionId && !resized) { sessions.resize(sessionId, 120, 40); resized = true }
      return !!sessionId && /(?:Try\s*"|manual\s*mode\s*on|for\s*shortcuts)/i.test(screenText().slice(-1000))
    }
    const approveKnownPrompt = async () => {
      if (!sessionId) return
      const tail = screenText(); write('screen.txt', tail)
      if (!trustSent && /Yes, I trust this folder|Yes, continue/.test(tail)) {
        trustSent = true; await sleep(1000); sessions.write(sessionId, '\x1b[B'); await sleep(400); sessions.write(sessionId, '\r'); interventions.push({ kind: 'automated-disposable-workspace-trust', at: new Date().toISOString() }); return
      }
      const edit = /Do\s+you\s+want\s+to\s+(?:overwrite|create|make\s+this\s+edit\s+to)\s+([^?\r\n]+)\?/g
      const editPrompts = [...tail.matchAll(edit)], lastEdit = editPrompts.at(-1)
      if (lastEdit && plan.fixture.editable.includes(lastEdit[1].trim())) {
        const signature = createHash('sha256').update(tail.slice(Math.max(0, lastEdit.index! - 1800), lastEdit.index! + lastEdit[0].length)).digest('hex')
        if (signature !== permissionSignature && Date.now() - permissionAt > 1000) {
          permissionSignature = signature; permissionAt = Date.now(); sessions.write(sessionId, '\r'); interventions.push({ kind: 'automated-manifest-file-approval', path: lastEdit[1].trim(), at: new Date().toISOString() }); return
        }
      }
      const index = tail.lastIndexOf('Do you want to proceed?'), commandStart = Math.max(tail.lastIndexOf('\n Bash command'), tail.lastIndexOf('\n PowerShell command'))
      const prefix = index >= 0 ? tail.slice(commandStart >= 0 && commandStart < index ? commandStart : Math.max(0, index - 2500), index) : ''
      const allowed = /(?:git\s+(?:show|diff|status|rev-parse|ls-tree|log|add|commit|-c\s)|node(?:\.exe)?["']?\s+--test)/.test(prefix) && !/(?:\brm\b|Remove-Item|\bpush\b|\breset\b|curl|Invoke-WebRequest|Invoke-Expression)/i.test(prefix)
      const signature = createHash('sha256').update(prefix).digest('hex')
      if (index >= 0 && allowed && (signature !== permissionSignature || Date.now() - permissionAt > 15000)) {
        permissionSignature = signature; permissionAt = Date.now(); sessions.write(sessionId, '\r'); interventions.push({ kind: 'automated-fixture-command-approval', at: new Date().toISOString(), prompt: prefix.slice(-1600) })
      }
    }
    while (Date.now() < launchDeadline) { await approveKnownPrompt(); if (await ready()) break; await sleep(500) }
    if (!(await ready())) throw Error('Lead launch/handshake timed out before submission')
    const common = `Disposable evaluation task: ${plan.fixture.title}. ${plan.fixture.brief}\nEditable implementation paths: ${plan.fixture.editable.join(', ')}. Do not modify acceptance.test.cjs or other files. Run node --test as a standalone command; do not append echo, $? or extra commands. Git inspection and local commits of implementation files are authorized; never change global configuration. Independently run "${nativeNode.replace(/\\/g, '/')}" --test after the final implementation is at a clean committed HEAD. No native subagents, nested CLIs or source checkout changes.`
    const team = 'Use the chorus-team tools to delegate implementation to the selected helpers. Review immutable artifacts, prepare each against the current integration HEAD, inspect/review its exact prepared result and apply under lead-integrates policy. For the parallel feature use two concurrent code tasks, one per module, with narrowly scoped acceptance; run the entire acceptance suite only after both modules are integrated. Artifact/prepared reviews can cite code inspection and helper-reported tests, including expected failures from another unfinished module. Independently test the final combined integrated result and submit accepted integrated review for each task. For integrated review originalResultSha=integration.resultSha, reviewedSha=verifiedHead=tests.testedSha=current clean HEAD. Use sourcePaths ["acceptance.test.cjs"], testSource tracked, executionContext integration, provenance lead-verified, outcome passed and exitCode 0. Finish only after every task is completed.'
    const solo = 'Implement this yourself without helpers. Commit only the allowed implementation files using per-command git -c user.name="Evaluation" -c user.email="evaluation@localhost" if identity is needed. Run the acceptance suite after committing. Finish your final response with EVALUATION_COMPLETE only after tests pass on the clean committed HEAD.'
    const assignment = plan.matrixVerification ? ' Assign slug.cjs to the Claude subscription helper and orders.cjs to the opencode API helper as two concurrent code tasks. Both roster members must perform their assigned implementation. Helpers must not commit; Chorus captures their immutable results.' : ''
    write('prompt.txt', common + '\n' + (runId ? team + assignment : solo))
    submittedAt = Date.now(); record.submittedAt = new Date(submittedAt).toISOString()
    sessions.write(sessionId, common + '\n' + (runId ? team + assignment : solo)); await sleep(500); sessions.write(sessionId, '\r')
    const deadline = submittedAt + plan.deadlineMs
    let completed = false
    while (Date.now() < deadline) {
      const control = path.join(evidence, 'input.json')
      if (fs.existsSync(control)) {
        const input = JSON.parse(fs.readFileSync(control, 'utf8')); fs.unlinkSync(control)
        if (input.abort) { record.censored = true; throw Error('Evaluation stopped by fixture controller; evidence retained') }
        if (typeof input.text === 'string') { sessions.write(sessionId, input.text); interventions.push({ kind: 'assistant-controller-input', at: new Date().toISOString(), reason: String(input.reason ?? 'unspecified') }) }
      }
      await approveKnownPrompt()
      if (runId) {
        lastSnapshot = runtime.service.getSnapshot(runId); write('snapshot.json', lastSnapshot)
        if (lastSnapshot.run.status === 'blocked') throw Error(lastSnapshot.run.blocker ?? 'Team blocked')
        completed = lastSnapshot.tasks.length > 0 && lastSnapshot.tasks.every(task => task.status === 'completed')
      } else completed = transcript().some(row => row.type === 'assistant' && !row.message?.content?.some((part: any) => part.type === 'tool_use') && row.message?.content?.some((part: any) => part.type === 'text' && /(?:^|\n)EVALUATION_COMPLETE[.!]?\s*$/.test(part.text)))
      if (completed) break
      if (!sessions.isRunning(sessionId)) throw Error('Lead exited before accepted completion')
      await sleep(1000)
    }
    if (!completed) { record.censored = true; throw Error('Matched evaluation deadline reached before accepted completion') }
    if (plan.matrixVerification) {
      record.matrixVerification = plan.matrixVerification
      if (!lastSnapshot?.run.config.helpers.every(member => lastSnapshot!.attempts.some(a => a.memberId === member.id && a.status === 'succeeded' && a.cessation === 'confirmed'))) throw Error('Mixed roster did not execute both selected authentication families')
    }
    for (const [name, expected] of Object.entries(plan.fileHashes)) if (!plan.fixture.editable.includes(name) && hash(path.join(cwd, name)) !== expected) throw Error(`Acceptance/input file changed: ${name}`)
    if (git(cwd, 'status', '--porcelain')) throw Error('Final result is not a clean committed tree')
    if (git(source, 'rev-parse', 'HEAD') !== plan.baseSha || git(source, 'status', '--porcelain')) throw Error('Source checkout changed')
    const test = spawnSync(nativeNode, ['--test'], { cwd, encoding: 'utf8', windowsHide: true, timeout: 30000 })
    write('acceptance.log', (test.stdout ?? '') + (test.stderr ?? ''))
    record.acceptanceExitCode = test.status; record.verifiedHead = git(cwd, 'rev-parse', 'HEAD')
    if (test.status !== 0) throw Error('Independent matched acceptance tests failed')
    finishedAt = Date.now(); record.passed = true; record.censored = false
  } catch (error) { record.failure = error instanceof Error ? error.message : String(error); record.censored ??= false; finishedAt = Date.now() }
  finally {
    record.finishedAt = new Date(finishedAt || Date.now()).toISOString(); record.elapsedMs = submittedAt ? (finishedAt || Date.now()) - submittedAt : null
    record.interventions = interventions; record.controllerInterventions = interventions.filter((i: any) => i.kind === 'assistant-controller-input').length; record.humanInterventions = 0; record.automatedInterventions = interventions.length - Number(record.controllerInterventions)
    const messages = new Map<string, any>()
    for (const row of transcript()) if (row.type === 'assistant' && row.message?.id && row.message.usage) messages.set(row.message.id, row.message.usage)
    record.leadUsage = messages.size ? { source: 'assigned Claude conversation, deduplicated assistant message IDs', inputTokens: [...messages.values()].reduce((n, u) => n + (u.input_tokens ?? 0), 0), outputTokens: [...messages.values()].reduce((n, u) => n + (u.output_tokens ?? 0), 0), cacheReadTokens: [...messages.values()].reduce((n, u) => n + (u.cache_read_input_tokens ?? 0), 0), cacheCreationTokens: [...messages.values()].reduce((n, u) => n + (u.cache_creation_input_tokens ?? 0), 0), messages: messages.size, billedUsd: null } : null
    record.helperUsage = lastSnapshot?.attempts.map(a => ({ attemptId: a.id, memberId: a.memberId, status: a.status, usage: a.usage })) ?? []
    record.attempts = lastSnapshot?.attempts.length ?? 0; record.revisions = lastSnapshot?.attempts.filter(a => a.number > 1).length ?? 0
    record.usageCoverage = 'Lead transcript and available normalized helper events; cache-creation helper tokens may be unavailable. Subscription billed cost unknown. No complete total-cost claim.'
    write('report.json', record)
    if (ownershipTimer) clearInterval(ownershipTimer)
    try {
      await runtime.shutdown()
      if (runId) {
        const stopped = runtime.service.getSnapshot(runId)
        if (stopped.attempts.some(a => !['confirmed', 'not-started'].includes(a.cessation)) || !(await runtime.leadStopped(stopped.run))) throw Error('Team process cessation remains unconfirmed after shutdown')
      }
      if (!runId && owned.length) {
        while (pollInFlight) await sleep(25)
        const observed = await windowsHelperPlatform.inspect(owned[0].pid, owned)
        if (observed.uncertain) throw Error('Baseline cessation cannot be proved')
        await windowsHelperPlatform.stop(observed.identities).catch(() => {})
        sessions.kill(sessionId)
        const deadline=Date.now()+5000
        let stopped=false
        do { const after=await windowsHelperPlatform.inspect(owned[0].pid,owned);stopped=!after.uncertain&&after.identities.length===0;if(stopped)break;await sleep(100) } while(Date.now()<deadline)
        if (!stopped) throw Error('Baseline processes survived cleanup or identity remains unknown')
      }
      record.shutdownConfirmed = true
    } catch (error) { record.shutdownConfirmed = false; record.shutdownError = error instanceof Error ? error.message : String(error) }
    write('report.json', record); screen.dispose(); sessions.dispose(); storage.close(); app.exit(record.shutdownConfirmed === false ? 2 : 0)
  }
}).catch(error => { write('failure.json', { message: error.message, stack: error.stack }); app.exit(1) })
