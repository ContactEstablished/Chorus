// Actual packaged main/renderer checks using a freshly prepared disposable profile.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import net from 'node:net'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import neo4j from 'neo4j-driver'
import { verifyNamedMembers } from './team-member-ui-checks.mjs'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const exe = path.resolve(process.env.CHORUS_TEAM_PACKAGED_EXE)
const uri = process.env.CHORUS_TEAM_APP_MEMORY_URI
const codexSmoke = process.argv.includes('--codex-team-smoke')
assert(fs.existsSync(exe))
if (uri) assert(/^bolt:\/\/127\.0\.0\.1:\d+$/.test(uri))
const prepared = execFileSync(process.execPath, ['scripts/verify-team-app.mjs', '--history', '--credential-refusal', ...(codexSmoke ? ['--team-credential'] : [])], {
  env: { ...process.env, CHORUS_TEAM_APP_PREPARE_ONLY: '1' }, encoding: 'utf8', windowsHide: true, timeout: 60000,
})
const launch = JSON.parse(prepared.trim().split(/\r?\n/)[0])
const evidence = launch.evidence
const fixture = JSON.parse(fs.readFileSync(path.join(evidence, 'fixture-prepared.json'), 'utf8'))
assert(fixture.fixturePrepared && !fixture.applicationVerified)
const write = (name, value) => fs.writeFileSync(path.join(evidence, name), JSON.stringify(value, null, 2))
const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening')
const port = server.address().port; await new Promise(resolve => server.close(resolve))
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
const log = fs.openSync(path.join(evidence, 'packaged-app.log'), 'w')
const child = spawn(exe, [`--user-data-dir=${path.join(evidence, 'profile')}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { env, windowsHide: true, stdio: ['ignore', log, log] })
console.log(JSON.stringify({ evidence, pid: child.pid, port }))
let childExit = null, socket, evaluate, graph, result
process.on('exit', code => { write('driver-exit.json', { code, childExit, resultRecorded: !!result }); if (!result && code === 0) process.exitCode = 1 })
child.on('exit', (code, signal) => { childExit = { code, signal }; write('app-process-exit.json', childExit) })
const closed = once(child, 'close').then(([code, signal]) => { childExit = { code, signal }; write('app-exit.json', childExit) })
try {
  let target
  for (let i = 0; i < 120; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page' && t.url.includes('renderer/index.html')); if (target) break } catch {}
    await sleep(500)
  }
  assert(target)
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  const pending = new Map(); let sequence = 0
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data)), item = pending.get(message.id)
    if (!item) return
    pending.delete(message.id); clearTimeout(item.timer)
    if (message.error) item.reject(Error(message.error.message)); else item.resolve(message.result)
  })
  socket.addEventListener('close', () => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error('Packaged transport closed')) }; pending.clear() })
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error(`Timed out: ${method}`)) }, 30000)
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }))
  })
  evaluate = async expression => {
    const reply = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
    if (reply.exceptionDetails) throw Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text)
    return reply.result.value
  }
  const team = async (operation, input) => { const reply = await evaluate(`window.chorus.team.${operation}(${JSON.stringify(input)})`); assert(reply.ok, JSON.stringify(reply)); return reply.value }
  const click = async text => {
    for (let i = 0; i < 120; i++) {
      if (await evaluate(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled);if(!b)return false;b.click();return true})()`)) { await sleep(700); return }
      await sleep(250)
    }
    throw Error(`Missing enabled button: ${text}`)
  }
  const screenshot = async name => fs.writeFileSync(path.join(evidence, name), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  await sleep(4000)
  const projects = await evaluate('window.chorus.listProjects()')
  assert(projects.length === 1 && projects[0].id === fixture.projectId)
  const layout = await evaluate(`window.chorus.getLayout(${JSON.stringify(fixture.projectId)})`)
  const ordinary = layout.sessions.find(row => row.name === 'Credentialed ordinary restore fixture')
  assert(ordinary && ordinary.status === 'exited')
  const attached = await evaluate(`window.chorus.attachSession(${JSON.stringify({ sessionId: ordinary.id, agent: 'claude' })})`)
  assert.equal(attached.status, 'exited'); assert.equal(attached.buffer, '')
  assert(fs.readFileSync(path.join(evidence, 'packaged-app.log'), 'utf8').includes(`credentialed session healed -> exited (no keyless restore): ${ordinary.id}`))
  await evaluate(`window.chorus.setLayout(${JSON.stringify({ project_id: fixture.projectId, layout: null })})`)
  await cdp('Page.reload'); await sleep(3000)
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Launch an Agent'))?.click()`); await sleep(500)
  await click('Team session'); await sleep(2000)
  assert(await evaluate(`document.querySelector('[aria-labelledby="team-launch-title"]') !== null`))
  for (let i = 0; i < 120 && !(await evaluate(`!!document.querySelector('select[aria-label^="Helper "]')`)); i++) await sleep(250)
  const text = await evaluate('document.body.innerText')
  assert(text.includes('Concurrent helpers') && text.includes('Subscription spend is unknown'))
  const launchDefaults = await evaluate(`(()=>{const d=document.querySelector('[aria-labelledby="team-launch-title"]');const values=Array.from(d.querySelectorAll('select')).map(s=>s.value);return {values,helpers:d.querySelectorAll('select[aria-label^="Helper "]').length}})()`)
  assert.equal(launchDefaults.helpers, 2)
  assert(launchDefaults.values.includes('auto-clean') && launchDefaults.values.includes('npm-project') && launchDefaults.values.includes('focused'))
  await screenshot('packaged-launch.png')
  const namedMembers = await verifyNamedMembers({ evaluate, click, team, screenshot, cdp, projectId: fixture.projectId })
  const caps = await team('capabilities', { projectId: fixture.projectId })
  const presetChecks = []
  for (const leadId of ['claude', 'codex', 'codex-sol']) {
    const lead = caps.options.find(option => option.key === leadId && option.enabled)
    assert(lead)
    const helper = caps.options.find(option => option.key === 'codex')
    const config = { schemaVersion: 1, baseRevision: 'HEAD', lead: { ...lead.member, id: randomUUID() }, helpers: [{ ...helper.member, effort: null, id: randomUUID() }], concurrency: 2, executionMinutes: 5, integrationPolicy: 'ask' }
    const saved = await team('presetSave', { projectId: fixture.projectId, expectedVersion: null, label: `Packaged ${leadId}`, config })
    const preset = saved.find(row => row.label === `Packaged ${leadId}`)
    assert.equal(preset.version, 1)
    const stale = await evaluate(`window.chorus.team.presetDelete(${JSON.stringify({ projectId: fixture.projectId, id: preset.id, expectedVersion: 2 })})`)
    assert.equal(stale.code, 'STALE_VERSION')
    presetChecks.push({ lead: leadId, saved: true, staleRefused: true })
  }
  await cdp('Page.reload'); await sleep(3000)
  assert.equal((await team('presetList', { projectId: fixture.projectId })).length, 3)
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Launch an Agent'))?.click()`); await sleep(500)
  await click('Team session'); await sleep(1500); await click('Open lead'); await sleep(1000)
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Team ·'))?.click()`); await sleep(500)
  await evaluate(`for(const details of document.querySelectorAll('.team-body details'))details.open=true`)
  const panel = await evaluate(`document.querySelector('[aria-label="Team session"]')?.innerText`)
  assert(panel?.includes('Attempts: 3 / 3') && panel.includes('This task has used all three attempts'))
  fs.writeFileSync(path.join(evidence, 'packaged-history.txt'), panel); await screenshot('packaged-history.png')
  await evaluate(`document.querySelector('button[aria-label="Close Team view"]')?.click()`)
  const memory = []
  if (uri) {
    graph = neo4j.driver(uri, undefined, { connectionTimeout: 3000, maxTransactionRetryTime: 0 }); await graph.verifyConnectivity()
    for (const leadId of ['claude', 'codex']) {
      const lead = caps.options.find(option => option.key === leadId && option.enabled)
      const launched = await team('launch', { projectId: fixture.projectId, clientRequestId: randomUUID(), config: { schemaVersion: 1, baseRevision: 'HEAD', lead: { ...lead.member, id: randomUUID() }, helpers: [{ ...lead.member, effort: null, id: randomUUID() }], concurrency: 1, executionMinutes: 5, integrationPolicy: 'ask' } })
      let state, trusted = false
      for (let i = 0; i < 120; i++) {
        state = await team('snapshot', { runId: launched.runId, afterSequence: 0 }); write(`${leadId}-memory-snapshot.json`, state)
        assert.notEqual(state.run.status, 'blocked', state.run.blocker)
        if (state.run.status === 'active') break
        if (state.run.leadSessionId) {
          const terminal = await evaluate(`window.chorus.attachSession(${JSON.stringify({ sessionId: state.run.leadSessionId, agent: leadId })})`)
          const plain = terminal.buffer.replace(/\x1b\[\d*C/g, ' ').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
          if (!trusted && /Yes, continue|Yes, I trust this folder/.test(plain)) {
            trusted = true; await sleep(1200)
            if (leadId === 'claude') { await evaluate(`window.chorus.writeSession(${JSON.stringify(state.run.leadSessionId)},${JSON.stringify('\x1b[B')})`); await sleep(400) }
            await evaluate(`window.chorus.writeSession(${JSON.stringify(state.run.leadSessionId)},${JSON.stringify('\r')})`)
          }
        }
        await sleep(1000)
      }
      assert.equal(state.run.status, 'active')
      const session = graph.session({ database: 'neo4j' })
      let registration
      try {
        const rows = await session.run('MATCH (s:AgentSession {id: $id}) RETURN s.agent AS agent, s.chorusProjectId AS project, s.writtenVia AS via, s.model AS model', { id: state.run.leadSessionId })
        assert.equal(rows.records.length, 1); registration = rows.records[0].toObject()
        assert.equal(registration.agent, leadId); assert.equal(registration.project, fixture.projectId); assert.equal(registration.via, 'app'); assert.equal(registration.model, lead.member.model)
      } finally { await session.close() }
      await team('control', { runId: state.run.id, expectedVersion: state.run.version, clientRequestId: randomUUID(), action: 'stop' })
      for (let i = 0; i < 60; i++) { state = await team('snapshot', { runId: launched.runId, afterSequence: 0 }); if (state.run.status === 'stopped') break; await sleep(500) }
      assert.equal(state.run.status, 'stopped'); write(`${leadId}-memory-stopped.json`, state)
      memory.push({ lead: leadId, nativeTeamBridgeActive: true, graphRegistration: registration, stopConfirmed: true })
    }
  }
  const codexTeams = []
  if (codexSmoke) {
    const source = path.join(evidence, 'source'), git = (...args) => execFileSync('git', ['-C', source, ...args], { windowsHide: true, encoding: 'utf8' }).trim()
    const helper = caps.options.find(option => option.enabled && option.member.model === 'deepseek/deepseek-v4.1-flash' && option.member.credentialProfileId === fixture.fixtureCredentialProfileId); assert(helper, 'Selected saved DeepSeek helper credential is unavailable')
    const goal = 'Implement alpha.cjs exporting alpha(n)=n+1 and beta.cjs exporting beta(n)=n*2. Each helper owns one implementation file; README.md and acceptance.test.cjs are read-only committed contracts. Delegate both tasks together with team_delegate_many, review complete immutable diffs, integrate serially, run the node-test suite at final HEAD, review with verificationIds, and team_finish. Keep briefs concise, use references, and use decision waits up to 900000ms. Do not edit or run Git directly as lead. No native agents.'
    for (const key of ['codex', 'codex-sol']) {
      fs.writeFileSync(path.join(source, 'README.md'), goal + '\n'); fs.writeFileSync(path.join(source, 'alpha.cjs'), 'exports.alpha=n=>n;\n'); fs.writeFileSync(path.join(source, 'beta.cjs'), 'exports.beta=n=>n;\n')
      const acceptance = "const{test}=require('node:test'),a=require('node:assert/strict');test('alpha',()=>a.equal(require('./alpha.cjs').alpha(3),4));test('beta',()=>a.equal(require('./beta.cjs').beta(3),6));\n"
      fs.writeFileSync(path.join(source, 'acceptance.test.cjs'), acceptance)
      git('add', '.'); git('-c', 'user.name=Chorus Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', `Frozen ${key} fixture`)
      const lead = caps.options.find(option => option.enabled && option.key === key); assert(lead)
      const launched = await team('launch', { projectId: fixture.projectId, clientRequestId: randomUUID(), config: { schemaVersion: 1, baseRevision: 'HEAD', lead: { ...lead.member, id: randomUUID() }, helpers: [0, 1].map(i => ({ ...helper.member, id: randomUUID(), label: `DeepSeek ${i + 1}` })), concurrency: 2, executionMinutes: 5, integrationPolicy: 'lead-integrates', leadContext: 'standard', verificationProfile: 'node-test', publicationPolicy: 'auto-clean' } })
      let state, trusted = false, submitted = false
      for (let i = 0; i < 600; i++) {
        state = await team('snapshot', { runId: launched.runId, afterSequence: 0 }); write(`${key}-smoke-snapshot.json`, state)
        assert.notEqual(state.run.status, 'blocked', state.run.blocker); assert.notEqual(state.run.finish?.status, 'blocked', state.run.finish?.blocker)
        if (state.run.finish?.status === 'cleaned') break
        if (state.run.leadSessionId && !submitted) {
          const terminal = await evaluate(`window.chorus.attachSession(${JSON.stringify({ sessionId: state.run.leadSessionId, agent: 'codex' })})`)
          const plain = terminal.buffer.replace(/\x1b\[\d*C/g, ' ').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
          if (!trusted && /[›>]\s+1\. Trust and continue/.test(plain)) { trusted = true; await evaluate(`window.chorus.writeSession(${JSON.stringify(state.run.leadSessionId)},${JSON.stringify('\r')})`); await sleep(1500); continue }
          if (state.run.status === 'active' && plain.toLowerCase().includes(lead.member.model) && (trusted || !plain.includes('Trust and continue'))) {
            submitted = true; await evaluate(`window.chorus.writeSession(${JSON.stringify(state.run.leadSessionId)},${JSON.stringify(goal)})`); await sleep(2000); await evaluate(`window.chorus.writeSession(${JSON.stringify(state.run.leadSessionId)},${JSON.stringify('\r')})`)
          }
        }
        await sleep(1000)
      }
      assert.equal(state.run.status, 'completed'); assert.equal(state.run.finish?.status, 'cleaned'); assert.deepEqual(state.run.finish.retainedWorktreeIds, [])
      assert.equal(fs.readFileSync(path.join(source, 'acceptance.test.cjs'), 'utf8'), acceptance); assert.equal(fs.readFileSync(path.join(source, 'README.md'), 'utf8'), goal + '\n'); assert.equal(git('status', '--porcelain'), '')
      execFileSync(process.execPath, ['--test'], { cwd: source, windowsHide: true, timeout: 30000 })
      const timing = state.attempts.filter(a => a.startedAt && a.endedAt), overlap = timing.some(a => timing.some(b => a.memberId !== b.memberId && Date.parse(a.startedAt) < Date.parse(b.endedAt) && Date.parse(b.startedAt) < Date.parse(a.endedAt)))
      assert(overlap, 'Two packaged helpers did not overlap')
      codexTeams.push({ lead: lead.member.model, effort: lead.member.effort, passed: true, overlap, destinationPublished: true, allWorktreesRemoved: true, retries: state.attempts.length - state.tasks.length })
    }
  }
  result = { passed: true, runtime: 'packaged', executable: exe, isolatedProfile: true, launchDialog: true, launchDefaults, namedMembers, presetChecks, presetReload: true, exhaustedHistory: true, historyScope: 'Three deterministic core preparation failures; no helper process for history', ordinaryCredentialRestoreRefused: true, memory, codexTeams, injectedMemoryCallback: false, graphIndexingExercised: false, evidence, at: new Date().toISOString() }
} catch (error) { write('failure.json', { message: String(error), stack: error.stack }); process.exitCode = 1 }
finally {
  if (graph) await graph.close()
  if (evaluate && !childExit) { try { await evaluate('window.chorus.closeWindow()') } catch {} }
  let timer
  const clean = await Promise.race([closed.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 45000) })]); clearTimeout(timer)
  if (!clean || childExit?.code !== 0) { write('shutdown-failure.json', { childExit, clean }); process.exitCode = 1 }
  socket?.close(); fs.closeSync(log)
}
if (!result) process.exitCode = 1
if (result && !process.exitCode) write('report.json', { ...result, appExitCode: childExit.code })
console.log(JSON.stringify({ passed: !process.exitCode, evidence, childExit }))
