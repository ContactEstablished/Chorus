// Real production composition, disposable repository/profile only. No installed app data.
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { StorageService } from '../src/main/services/storage'
import { SessionManager } from '../src/main/services/sessionManager'
import { CredentialVault } from '../src/main/services/vault'
import { GitWorktreeManager } from '../src/main/services/worktrees'
import { TeamRuntime } from '../src/main/services/teamRuntime'
;(globalThis as any).self = globalThis
const { Terminal } = require('@xterm/xterm') as typeof import('@xterm/xterm')
const evidence = process.env.CHORUS_TEAM_PRODUCTION_EVIDENCE!
const mcpOnly = process.env.CHORUS_TEAM_PRODUCTION_MCP === '1'
const neo4jOnly = process.env.CHORUS_TEAM_PRODUCTION_MCP === 'neo4j'
app.setPath('userData', path.join(evidence, 'profile'))
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const write = (name: string, value: unknown) => fs.writeFileSync(path.join(evidence, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2))
app.whenReady().then(async () => {
  const source = path.join(evidence, 'source'); fs.mkdirSync(source)
  const git = (...args: string[]) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', windowsHide: true }).trim()
  git('init', '-q'); fs.writeFileSync(path.join(source, 'sum.cjs'), 'exports.sum=(a,b)=>a-b;\n')
  fs.writeFileSync(path.join(source, 'sum.test.cjs'), "const{test}=require('node:test');const assert=require('node:assert/strict');const{sum}=require('./sum.cjs');test('sum',()=>assert.equal(sum(2,3),5));\n")
  git('add', '.'); git('-c', 'user.name=Chorus Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Fixture')
  const storage = new StorageService(path.join(evidence, 'fixture.db')), sessions = new SessionManager()
  sessions.bindStorage(storage); sessions.bindInstructionsDir(path.join(evidence, 'instructions'))
  sessions.onExit((id, code) => storage.updateSessionStatus(id, 'exited', code))
  const nonce = randomUUID(), nativeNode = execFileSync('where.exe', ['node.exe'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)[0]
  const nativeUvx = neo4jOnly ? execFileSync('where.exe',['uvx.exe'],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/)[0] : ''
  const runtime = new TeamRuntime({ storage, sessions, vault: new CredentialVault(storage), worktrees: new GitWorktreeManager(storage), configDirectory: path.join(evidence, 'config'), bridgeScript: path.resolve('resources/teamBridge.cjs'), memory: async () => ({ servers: neo4jOnly ? [{ name: 'neo4j', command: nativeNode, args: [path.resolve('scripts/team-neo4j-probe.cjs')], env: { NEO4J_URL: 'bolt://127.0.0.1:7691', NEO4J_DATABASE: 'neo4j', CHORUS_NEO4J_UVX:nativeUvx, CHORUS_NEO4J_PROBE: nonce, CHORUS_NEO4J_EVIDENCE: path.join(evidence, 'neo4j-probe.json') } }] : mcpOnly ? [{ name: 'memory-fixture', command: nativeNode, args: [path.resolve('scripts/team-memory-fixture.cjs')], env: { CHORUS_FIXTURE_NONCE: nonce, CHORUS_FIXTURE_EVIDENCE: path.join(evidence, 'memory-probe.json') } }] : [], instructions: mcpOnly || neo4jOnly ? 'A memory MCP peer is composed with Team. The constant RETURN probe is read-only and explicitly authorized for this fixture. Do not query or modify graph data.' : undefined }) })
  await runtime.start()
  const screen = new Terminal({cols:80,rows:24,allowProposedApi:true})
  let timer: ReturnType<typeof setInterval> | null = null
  try {
    const { project } = storage.getOrCreateProject(source), capabilities = await runtime.capabilities()
    const leadOption = capabilities.options.find(o => o.key === (process.env.CHORUS_TEAM_PRODUCTION_LEAD ?? 'claude'))!, helperOption = capabilities.options.find(o => o.key === 'claude')!
    assert(leadOption.enabled && helperOption.enabled)
    const config = { schemaVersion: 1, baseRevision: 'HEAD', lead: { ...leadOption.member, id: randomUUID() }, helpers: [{ ...helperOption.member, id: randomUUID() }], concurrency: 2, executionMinutes: 5, integrationPolicy: 'lead-integrates' }
    const ack = await runtime.service.createRun({ projectId: project.id, clientRequestId: 'production-fixture', config }, { role: 'user', principal: 'production-fixture' }), runId = String(ack.runId)
    let terminal = '', trustSent = false, trustApproved = false, promptSent = false, approved = false
    sessions.onData((sessionId, text) => {
      const run = runtime.teams.getRun(runId); if (sessionId !== run.leadSessionId) return
      terminal += text; screen.write(text);write('terminal.log', terminal)
      const plain = terminal.replace(/\x1b\[\d*C/g, ' ').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      if (!trustSent && /Yes, I trust this folder|Yes, continue|Trust this (?:folder|directory)/i.test(plain)) { trustSent = true; write('trust-required.json', { sessionId, harness: run.config.lead.harness, scope: 'new disposable fixture only' }) }
    })
    timer = setInterval(() => { const file = path.join(evidence, 'input.json'); if (fs.existsSync(file)) { const input = JSON.parse(fs.readFileSync(file, 'utf8')); fs.unlinkSync(file); const id = runtime.teams.getRun(runId).leadSessionId; if (id && typeof input.text === 'string') sessions.write(id, input.text) } }, 300)
    const deadline = Date.now() + (neo4jOnly ? 240000 : 900000)
    while (Date.now() < deadline) {
      const snapshot = runtime.service.getSnapshot(runId); write('snapshot.json', snapshot)
      const screenText=Array.from({length:screen.rows},(_,i)=>screen.buffer.active.getLine(screen.buffer.active.baseY+i)?.translateToString(true)??'').join('\n');write('screen.txt',screenText)
      if(neo4jOnly&&!trustApproved&&snapshot.run.leadSessionId&&/Yes, I trust this folder|Yes, continue/.test(screenText)) {
        trustApproved=true;await sleep(1000)
        if(config.lead.harness==='claude'){sessions.write(snapshot.run.leadSessionId,'\x1b[B');await sleep(400)}
        sessions.write(snapshot.run.leadSessionId,'\r');write('controller-interventions.json',[{action:'Automated scoped disposable-workspace trust',at:new Date().toISOString()}])
      }
      if (snapshot.run.status === 'blocked') throw Error(snapshot.run.blocker ?? 'Run blocked')
      if (snapshot.run.status === 'active' && snapshot.run.leadSessionId && !promptSent) {
        promptSent = true
        const prompt = 'This is a disposable Chorus production integration fixture. Use the chorus-team tools. Call team_roster, then delegate one code task to the Claude helper: fix sum.cjs so sum(a,b) adds exactly two numeric arguments; variadic summation is out of scope, run node --test as a standalone command without echo or $? appended, do not modify sum.test.cjs or commit. Wait for the result. Inspect the immutable artifact using git show in this integration worktree, review it, prepare integration against the current integration HEAD, inspect the prepared diff, review the exact prepared SHA, and apply without human approval. Artifact and prepared reviews may use code inspection and attributed helper test evidence; do not export extra scratchpad copies. Apply that reviewed result, run "C:/Program Files/nodejs/node.exe" --test in the integration workspace through Bash, and submit integrated review. For integrated review originalResultSha must be integration.resultSha (the prepared/promoted commit, NOT the helper artifact SHA); reviewedSha, verifiedHead and tests.testedSha must all equal the clean current integration HEAD. Record exit code 0, sourcePaths ["sum.test.cjs"], testSource tracked, executionContext integration and provenance lead-verified. Complete only after the task is completed. Do not use native subagents or modify the source checkout. This bounded fixture authorizes the required Git inspection and node test commands in this disposable workspace. Finish with TEAM_PRODUCTION_COMPLETE.'
        sessions.write(snapshot.run.leadSessionId, neo4jOnly ? `This is a read-only MCP coexistence test. Call chorus-team team_roster, then neo4j read_neo4j_cypher with query exactly RETURN '${nonce}' AS chorus_probe. This constant query reads no graph data and is explicitly authorized. Do not query schema, delegate, modify files, write graph data or run shell commands. Finish with NEO4J_FIXTURE_OK.` : mcpOnly ? 'This is a disposable MCP composition test. Call chorus-team team_roster, then call memory-fixture fixture_memory_probe with empty arguments. Do not delegate, modify files or run shell commands. The read-only probe is explicitly authorized. Finish with MEMORY_FIXTURE_OK.' : prompt); await sleep(500); sessions.write(snapshot.run.leadSessionId, '\r')
      }
      if (neo4jOnly && fs.existsSync(path.join(evidence, 'neo4j-probe.json'))) {
        const probe=JSON.parse(fs.readFileSync(path.join(evidence,'neo4j-probe.json'),'utf8'))
        assert(probe.passed && probe.constantReadQuery);assert.equal(snapshot.run.status,'active')
        write('report.json',{passed:true,lead:config.lead.harness,actualNeo4jMcpComposed:true,constantReadQuery:true,teamBridgeActive:true,evidence,at:new Date().toISOString()});return
      }
      if (mcpOnly && fs.existsSync(path.join(evidence, 'memory-probe.json'))) {
        const probe = JSON.parse(fs.readFileSync(path.join(evidence, 'memory-probe.json'), 'utf8'))
        assert(probe.noncePresent && probe.noNonceInArgs); assert(!terminal.includes(nonce)); assert.equal(snapshot.run.status, 'active')
        write('report.json', { passed: true, lead: config.lead.harness, memoryMcpComposed: true, environmentOnlyNonce: true, teamBridgeActive: true, evidence, at: new Date().toISOString() }); return
      }
      if (snapshot.tasks.length && snapshot.tasks.every(t => t.status === 'completed')) {
        assert(approved); assert.equal(git('show', 'HEAD:sum.cjs'), 'exports.sum=(a,b)=>a-b;')
        assert.equal(git('status', '--porcelain'), '')
        write('report.json', { passed: true, lead: config.lead.harness, runId, integrationHead: snapshot.run.integrationHead, sourcePreserved: true, taskCount: snapshot.tasks.length, evidence, at: new Date().toISOString() }); return
      }
      await sleep(1000)
    }
    throw Error('Production lead fixture timed out; retained snapshot and terminal explain its state.')
  } catch (error) { write('failure.json', { message: error instanceof Error ? error.message : String(error), evidence }); process.exitCode = 1 }
  finally {
    if (timer) clearInterval(timer)
    try {
      await runtime.shutdown()
      for(const id of runtime.teams.listRunIds()) {
        const state=runtime.service.getSnapshot(id)
        assert(state.attempts.every(a=>['confirmed','not-started'].includes(a.cessation)),'Helper cessation unconfirmed')
        assert(await runtime.leadStopped(state.run),'Lead cessation unconfirmed')
      }
      const reportPath=path.join(evidence,'report.json')
      if(fs.existsSync(reportPath)){const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));write('report.json',{...report,shutdownConfirmed:true})}
    } catch(error){write('failure.json',{message:error instanceof Error?error.message:String(error),stage:'shutdown',evidence});process.exitCode=1}
    screen.dispose();sessions.dispose();storage.close();app.exit(Number(process.exitCode??0))
  }
}).catch(error => { write('failure.json', { message: error.message }); app.exit(1) })
