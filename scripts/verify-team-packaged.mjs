// Drives the actual unpacked executable over its local DevTools transport.
// Uses only a copied disposable fixture database, never the installed user's profile.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
globalThis.self = globalThis
const { Terminal } = require('@xterm/xterm')
async function currentScreen(buffer) {
  const terminal = new Terminal({ cols: 120, rows: 40, allowProposedApi: true })
  await new Promise(resolve => terminal.write(buffer, resolve))
  const text = Array.from({length: terminal.rows}, (_, i) => terminal.buffer.active.getLine(terminal.buffer.active.baseY + i)?.translateToString(true) ?? '').join('\n')
  terminal.dispose(); return text
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const sourceEvidence = process.argv[2] ? path.resolve(process.argv[2]) : null
const leadId = process.argv[3] ?? 'codex'
const development = process.argv.includes('--dev')
const recoveryWorkflow = process.argv.includes('--recovery')
const ordinaryRegression = process.argv.includes('--ordinary')
const quitActive = process.argv.includes('--quit-active')
const quitApply = process.argv.includes('--quit-apply')
const quitIntegration = process.argv.includes('--quit-integration') || quitApply
const retryActivation = process.argv.includes('--retry-activation')
const keyboardCheck = process.argv.includes('--keyboard')
let helperKey = process.argv.find(arg => arg.startsWith('--helper='))?.slice('--helper='.length) ?? 'claude'
const customModel = process.argv.find(arg => arg.startsWith('--custom-model='))?.slice('--custom-model='.length)
assert(helperKey, 'Select a nonempty capability key with --helper=')
const secondHelperKey = process.argv.find(arg => arg.startsWith('--second-helper='))?.slice('--second-helper='.length) ?? null
const workflow = process.argv[4] === 'workflow', policy = process.argv[5] === 'lead-integrates' ? 'lead-integrates' : 'ask'
assert(secondHelperKey===null || (secondHelperKey && workflow), 'A second helper requires a full workflow and nonempty capability key')
const implementations = [{file:'sum.cjs',test:'sum.test.cjs',initial:'exports.sum=(a,b)=>a-b;\n',testText:"const{test}=require('node:test');const assert=require('node:assert/strict');const{sum}=require('./sum.cjs');test('sum',()=>assert.equal(sum(2,3),5));\n",brief:'fix sum(a,b) in sum.cjs to add exactly two numeric arguments'}]
if(secondHelperKey)implementations.push({file:'product.cjs',test:'product.test.cjs',initial:'exports.product=(a,b)=>a+b;\n',testText:"const{test}=require('node:test');const assert=require('node:assert/strict');const{product}=require('./product.cjs');test('product',()=>assert.equal(product(2,3),6));\n",brief:'fix product(a,b) in product.cjs to multiply exactly two numeric arguments'})
if (workflow) {
  const source = path.join(sourceEvidence, 'source')
  assert(path.basename(sourceEvidence).startsWith('chorus-team-app-') && sourceEvidence.startsWith(os.tmpdir()), 'Workflow requires the disposable app fixture')
  for(const implementation of implementations) if (!fs.existsSync(path.join(source, implementation.file))) {
    fs.writeFileSync(path.join(source, implementation.file), implementation.initial)
    fs.writeFileSync(path.join(source, implementation.test), implementation.testText)
    execFileSync('git', ['-C', source, 'add', implementation.file, implementation.test], { windowsHide: true })
    execFileSync('git', ['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Packaged workflow fixture'], { windowsHide: true })
  }
}
assert(['claude', 'codex'].includes(leadId))
if (!sourceEvidence || !path.basename(sourceEvidence).startsWith('chorus-team-app-') || !path.resolve(sourceEvidence).startsWith(path.resolve(os.tmpdir())+path.sep)) throw Error('Use a completed disposable application verifier profile.')
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), development ? 'chorus-team-development-' : 'chorus-team-packaged-')), profile = path.join(evidence, 'profile')
fs.mkdirSync(profile); fs.copyFileSync(path.join(sourceEvidence, 'profile', 'chorus.db'), path.join(profile, 'chorus.db'))
if(fs.existsSync(path.join(sourceEvidence,'profile','Local State')))fs.copyFileSync(path.join(sourceEvidence,'profile','Local State'),path.join(profile,'Local State'))
const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port; await new Promise(resolve => server.close(resolve))
const exe = development ? require('electron') : path.resolve(process.env.CHORUS_TEAM_PACKAGED_EXE ?? '_verify/team-packaged/win-unpacked/Chorus.exe')
assert(fs.existsSync(development ? path.resolve('resources/teamBridge.cjs') : path.join(path.dirname(exe), 'resources', 'team', 'teamBridge.cjs')))
const log = fs.openSync(path.join(evidence, 'app.log'), 'w')
const appEnv = { ...process.env }; delete appEnv.ELECTRON_RUN_AS_NODE
const child = spawn(exe, [...(development ? [process.cwd()] : []), `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { env: appEnv, windowsHide: true, stdio: ['ignore', log, log] })
console.log(JSON.stringify({ evidence, pid: child.pid, port }))
let socket, sequence = 0, runId, sessionId, cdp
let childExit = null
child.once('exit', (code, signal) => { childExit = { code, signal }; fs.writeFileSync(path.join(evidence, 'app-exit.json'), JSON.stringify(childExit)) })
verification: { try {
  let target
  for (let i = 0; i < 120; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page' && t.url.includes('renderer/index.html')); if (target) break } catch {} await sleep(500) }
  assert(target, 'Packaged app renderer did not expose its verification connection')
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  const pending = new Map()
  const rejectPending = () => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error(`Packaged verification transport closed; app exit: ${JSON.stringify(childExit)}`)) }; pending.clear() }
  socket.addEventListener('close', rejectPending)
  socket.addEventListener('error', rejectPending)
  socket.addEventListener('message', event => { const message = JSON.parse(String(event.data)), item = pending.get(message.id); if (!item) return; pending.delete(message.id); clearTimeout(item.timer); if (message.error) item.reject(Error(message.error.message)); else item.resolve(message.result) })
  cdp = (method, params = {}) => new Promise((resolve, reject) => {
    if (socket.readyState !== WebSocket.OPEN) { reject(Error('Packaged verification transport is closed')); return }
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error(`Packaged verification timed out: ${method}`)) }, 30000)
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => { const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value }
  await sleep(3500)
  const projects = await evaluate('window.chorus.listProjects()')
  const project = projects.find(p => p.rootPath === path.join(sourceEvidence, 'source') || p.root_path === path.join(sourceEvidence, 'source'))
  assert(project && projects.every(p => String(p.rootPath ?? p.root_path).includes(sourceEvidence)), 'Packaged profile is not the isolated fixture')
  if (customModel) {
    const listing = await evaluate('window.chorus.team.memberList({})'); assert(listing.ok)
    const credential = listing.value.credentials.find(c => c.available); assert(credential, 'Custom model verifier requires the disposable selected API credential')
    const saved = await evaluate(`window.chorus.team.memberSave(${JSON.stringify({ expectedVersion: null, label: 'Custom coding helper', model: customModel, instructions: 'Implement only the delegated change and report the test result.', credentialProfileId: credential.id })})`)
    assert(saved.ok); helperKey = saved.value.profiles.find(p => p.label === 'Custom coding helper').id
  }
  const caps = await evaluate(`window.chorus.team.capabilities({projectId:${JSON.stringify(project.id)}})`); assert(caps.ok)
  const lead = caps.value.options.find(o => o.key === leadId && o.enabled), helper = structuredClone(caps.value.options.find(o => o.key === helperKey && o.enabled)); assert(lead && helper, 'Requested lead/helper capability is unavailable'); helper.member.id = crypto.randomUUID()
  const helpers=[helper]
  if(secondHelperKey){const second=structuredClone(caps.value.options.find(o=>o.key===secondHelperKey && o.enabled));assert(second,'Requested second helper is unavailable');second.member.id=crypto.randomUUID();helpers.push(second)}
  const input = { projectId: project.id, clientRequestId: 'packaged-bridge-fixture', config: { schemaVersion: 1, baseRevision: 'HEAD', lead: lead.member, helpers: helpers.map(option=>option.member), concurrency: 2, executionMinutes: 5, integrationPolicy: policy } }
  const launched = await evaluate(`window.chorus.team.launch(${JSON.stringify(input)})`); assert(launched.ok); runId = launched.value.runId
  let trusted = false, active = false, activationRetryVerified = false
  for (let i = 0; i < 90; i++) {
    const reply = await evaluate(`window.chorus.team.snapshot({runId:${JSON.stringify(runId)},afterSequence:0})`); assert(reply.ok)
    fs.writeFileSync(path.join(evidence, 'snapshot.json'), JSON.stringify(reply.value, null, 2))
    sessionId = reply.value.run.leadSessionId
    if (reply.value.run.status === 'blocked') throw Error(reply.value.run.blocker)
    if (reply.value.run.status === 'active') { active = true; break }
    if (sessionId) {
      const terminal = await evaluate(`window.chorus.attachSession({sessionId:${JSON.stringify(sessionId)},agent:${JSON.stringify(leadId)}})`)
      fs.writeFileSync(path.join(evidence, 'terminal.log'), terminal.buffer)
      const plain = terminal.buffer.replace(/\x1b\[\d*C/g, ' ').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      if (!trusted && /Yes, continue|Yes, I trust this folder/.test(plain)) {
        if(retryActivation) {
          let waiting
          for(let poll=0;poll<75;poll++){waiting=await evaluate(`window.chorus.team.snapshot({runId:${JSON.stringify(runId)},afterSequence:0})`);if(waiting.value.events.some(e=>e.operation==='bridge-timeout'))break;await sleep(1000)}
          assert(waiting.value.events.some(e=>e.operation==='bridge-timeout'),'Bridge timeout was not recorded while native trust was pending')
          await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Launch an Agent'))?.click()`);await sleep(400)
          await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Team session')?.click()`);await sleep(1200)
          await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Open lead')?.click()`);await sleep(1000)
          await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Team ·'))?.click()`);await sleep(300)
          assert(await evaluate(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Retry activation');if(!b)return false;b.click();return true})()`))
          await sleep(600)
          const after=await evaluate(`window.chorus.team.snapshot({runId:${JSON.stringify(runId)},afterSequence:0})`)
          assert.equal(after.value.run.status,'preparing');assert.equal(after.value.run.leadSessionId,sessionId);assert.equal(after.value.run.generation,waiting.value.run.generation)
          assert.equal(after.value.events.filter(e=>e.operation==='lead-started').length,1)
          const text=await evaluate(`document.querySelector('[aria-label="Team session"]')?.innerText`);assert(/bridge|handshake/i.test(text));fs.writeFileSync(path.join(evidence,'activation-retry.txt'),text)
          fs.writeFileSync(path.join(evidence,'activation-retry.png'),Buffer.from((await cdp('Page.captureScreenshot',{format:'png'})).data,'base64'))
          await evaluate(`document.querySelector('button[aria-label="Close Team view"]')?.click()`);await sleep(400)
          activationRetryVerified=true
        }
        trusted = true; await sleep(2000); if (leadId === 'claude') { await evaluate(`window.chorus.writeSession(${JSON.stringify(sessionId)},${JSON.stringify('\x1b[B')})`); await sleep(800) }; await evaluate(`window.chorus.writeSession(${JSON.stringify(sessionId)},${JSON.stringify('\r')})`)
      }
    }
    await sleep(1000)
  }
  assert(active, 'Packaged native Node bridge did not handshake')
  if(retryActivation)assert(activationRetryVerified,'Activation retry was not exercised; use a fresh untrusted disposable source fixture')
  const owned = await evaluate(`window.chorus.team.snapshot({runId:${JSON.stringify(runId)},afterSequence:0})`)
  const guards = await evaluate(`(async()=>{
    const results=[]; const sessionId=${JSON.stringify(sessionId)};
    for(const method of ['restartSession','relaunchSession']) results.push(await window.chorus[method](sessionId));
    for(const method of ['killSession','deleteSession']) { try { await window.chorus[method](sessionId); results.push({ok:true}) } catch(e) { results.push({ok:false,reason:String(e)}) } }
    results.push(await window.chorus.removeWorktree({worktreeId:${JSON.stringify(owned.value.run.integrationWorktreeId)}}));
    try { await window.chorus.deleteProject(${JSON.stringify(project.id)},${JSON.stringify(project.name)}); results.push({ok:true}) } catch(e) { results.push({ok:false,reason:String(e)}) }
    try { await window.chorus.setProjectStatus({project_id:${JSON.stringify(project.id)},status:'archived'}); results.push({ok:true}) } catch(e) { results.push({ok:false,reason:String(e)}) }
    return results;
  })()`)
  assert.equal(guards.length, 7); assert(guards.every(result => result.ok === false && /Team/i.test(result.reason)), 'Ordinary lifecycle bypass was not refused')
  fs.writeFileSync(path.join(evidence, 'ownership-guards.json'), JSON.stringify(guards, null, 2))
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Launch an Agent'))?.click()`); await sleep(400)
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Team session')?.click()`); await sleep(2500)
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Open lead')?.click()`); await sleep(1500)
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Team ·'))?.click()`); await sleep(400)
  const image = await cdp('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(evidence, 'team-panel.png'), Buffer.from(image.data, 'base64'))
  assert(await evaluate(`document.body.innerText.includes('Team · active')`), 'Packaged Team panel did not attach')
  let keyboardVerified = false
  if (keyboardCheck) {
    const observations = []
    for (const expanded of [false, true]) {
      await evaluate(`(()=>{const button=document.querySelector('.team-bar button');if(button?.getAttribute('aria-expanded')!==${JSON.stringify(String(expanded))})button?.click()})()`)
      await sleep(700)
      const rect = await evaluate(`(()=>{const r=document.querySelector('.xterm')?.getBoundingClientRect();return r?{x:r.left+15,y:r.top+r.height-20}:null})()`)
      assert(rect, 'Lead terminal is not visible')
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...rect, button: 'left', clickCount: 1 })
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...rect, button: 'left', clickCount: 1 })
      assert(await evaluate(`document.activeElement?.classList.contains('xterm-helper-textarea')`), 'Clicking the lead did not restore terminal keyboard focus')
      const marker = `TEAMKEYBOARD${expanded ? 'EXPANDED' : 'COLLAPSED'}`
      for (const character of marker) await cdp('Input.dispatchKeyEvent', { type: 'char', text: character, unmodifiedText: character })
      let observed = ''
      for (let i=0;i<12;i++) { const attached=await evaluate(`window.chorus.attachSession(${JSON.stringify({sessionId,agent:leadId})})`);observed=await currentScreen(attached.buffer);if(observed.includes(marker))break;await sleep(250) }
      fs.writeFileSync(path.join(evidence,`keyboard-${expanded?'expanded':'collapsed'}.txt`),observed)
      assert(observed.includes(marker), 'Keyboard characters did not reach the native lead prompt')
      // Clear the unsent line without submitting any model request.
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'u', code: 'KeyU', windowsVirtualKeyCode: 85, modifiers: 2 })
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'u', code: 'KeyU', windowsVirtualKeyCode: 85, modifiers: 2 })
      await sleep(500)
      observations.push({ expanded, nativePromptEcho: true, submitted: false })
    }
    keyboardVerified = true
    fs.writeFileSync(path.join(evidence,'keyboard.json'),JSON.stringify(observations,null,2))
  }
  const quitAndVerify = async (running, kind) => {
    fs.writeFileSync(path.join(evidence,'before-quit.json'),JSON.stringify(running,null,2))
    const exited=once(child,'close')
    await evaluate('window.chorus.closeWindow()')
    let quitTimer
    const finished=await Promise.race([exited.then(()=>true),new Promise(resolve=>{quitTimer=setTimeout(()=>resolve(false),45000)})]);clearTimeout(quitTimer)
    assert(finished,'Application did not finish Team shutdown')
    assert.equal(childExit.code,0)
    const inspectScript=`const DB=require('better-sqlite3');const db=new DB(process.argv[1],{readonly:true});const id=process.argv[2];const rows=t=>db.prepare('SELECT record_json FROM '+t+' WHERE '+(t==='team_runs'?'id':'run_id')+'=?').all(id).map(r=>JSON.parse(r.record_json));const result={run:rows('team_runs')[0],attempts:rows('team_attempts'),tasks:rows('team_tasks'),integrations:rows('team_integrations'),events:db.prepare('SELECT sequence,operation FROM team_events WHERE run_id=? ORDER BY sequence').all(id),session:db.prepare('SELECT status FROM sessions WHERE id=?').get(process.argv[3])};db.close();process.stdout.write(JSON.stringify(result));`
    const readClosed = () => JSON.parse(execFileSync(require('electron'),['-e',inspectScript,path.join(profile,'chorus.db'),runId,sessionId],{cwd:process.cwd(),env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,encoding:'utf8',timeout:15000}))
    const after=readClosed()
    assert.equal(after.run.status,'stopped');assert.equal(after.session.status,'exited')
    assert(after.attempts.length>0&&after.attempts.every(a=>['confirmed','not-started'].includes(a.cessation)))
    assert(after.attempts.every(a=>!['preparing','running','cancelling'].includes(a.status)))
    assert(after.events.some(e=>e.operation==='shutdown-intent'));assert(after.events.some(e=>e.operation==='lead-stopped'))
    if(kind==='integration') {
      assert(running.integrations.some(i=>['preparing','applying'].includes(i.status)))
      assert(running.integrations.every(i=>after.integrations.some(retained=>retained.id===i.id)))
      assert(after.integrations.every(i=>!['preparing','applying'].includes(i.status)))
      for(const implementation of implementations)assert.equal(fs.readFileSync(path.join(sourceEvidence,'source',implementation.file),'utf8'),implementation.initial)
    }
    fs.writeFileSync(path.join(evidence,'after-quit.json'),JSON.stringify(after,null,2))
    fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({passed:true,runtime:development?'development':'packaged',lead:leadId,activeHelperQuit:kind==='helper',activeIntegrationQuit:kind==='integration',integrationPhasesAtQuit:running.integrations.map(i=>i.status),appExitCode:childExit.code,shutdownConfirmed:true,attemptCount:after.attempts.length,ownershipGuards:7,evidence,at:new Date().toISOString()},null,2))
  }
  if (quitActive) {
    const prompt=`This is a disposable application-quit test. Use team_delegate to start one analysis task with the selected ${helper.member.harness} helper (member ${helper.member.id}): inspect the tracked files in this workspace, explain their behavior, and report possible test improvements without editing or committing anything. Do not do the analysis yourself. Wait through team_wait after delegation. The application will close while the helper is running.`
    await evaluate(`window.chorus.writeSession(${JSON.stringify(sessionId)},${JSON.stringify(prompt)})`);await sleep(600);await evaluate(`window.chorus.writeSession(${JSON.stringify(sessionId)},${JSON.stringify('\r')})`)
    let running
    for(let i=0;i<240;i++) {
      const state=await evaluate(`window.chorus.team.snapshot({runId:${JSON.stringify(runId)},afterSequence:0})`)
      if(state.value.attempts.some(a=>a.status==='running'&&a.process)){running=state.value;break}
      await sleep(500)
    }
    assert(running,'Quit fixture did not reach a native running helper')
    await quitAndVerify(running,'helper')
    break verification
  }
  let peakRunningHelpers = 0
  let workflowCompleted = false, approvalViaUi = false, activityVisible = false, staleApprovalRefused = false, approvalRendererReload = false, finalAcceptance = null
  if (workflow) {
    const assignments=helpers.map((option,index)=>`Delegate a code task to the selected ${option.member.harness} helper (member ${option.member.id}): ${implementations[index].brief}; edit only ${implementations[index].file}; run exactly node --test as a standalone command with no filename arguments, chaining, echo or redirection. The native helper allow rule permits only that exact test command. Report the result honestly; failures in another unfinished module are expected and do not require editing that module. Preserve all tests and do not commit.`).join(' ')
    const prompt = `This is a disposable packaged Chorus workflow test. Use chorus-team tools. ${assignments} ${helpers.length>1?'Start both tasks concurrently.':''} Review each immutable artifact via git show; prepare one at a time against the current integration HEAD; inspect and review each exact prepared SHA. Artifact and prepared review may cite scoped module tests or code inspection; another unfinished module is expected to fail until integrated. Policy is ${policy}; ${policy === 'ask' ? 'wait for the user to approve each result in the Team panel' : 'the user authorizes your reviewed integrations'}. Apply all reviewed results, then run "C:/Program Files/nodejs/node.exe" --test in the integration worktree and submit integrated review for each task. For integrated review originalResultSha is that integration.resultSha, NOT the helper artifact. reviewedSha, verifiedHead and tests.testedSha are the final current clean HEAD. Use executionContext integration, provenance lead-verified, testSource tracked, sourcePaths ${JSON.stringify(implementations.map(item=>item.test))}, outcome passed and exitCode 0. No variadic arithmetic, scratch files, native subagents or source checkout edits. Stop after every task reaches completed. Git inspection and these node tests are authorized in this disposable fixture.`
    await evaluate(`window.chorus.writeSession(${JSON.stringify(sessionId)},${JSON.stringify(prompt)})`); await sleep(600); await evaluate(`window.chorus.writeSession(${JSON.stringify(sessionId)},${JSON.stringify('\r')})`)
    await evaluate(`window.chorus.resizeSession(${JSON.stringify(sessionId)},120,40)`)
    let approvedPrompt = '', approvedAt = 0
    const workflowDeadline=Date.now()+720000
    while(Date.now()<workflowDeadline) {
      const state = await evaluate(`window.chorus.team.snapshot({runId:${JSON.stringify(runId)},afterSequence:0})`); assert(state.ok)
      fs.writeFileSync(path.join(evidence,'workflow.json'),JSON.stringify(state.value,null,2))
      peakRunningHelpers=Math.max(peakRunningHelpers,state.value.attempts.filter(attempt=>attempt.status==='running').length)
      if(quitIntegration && state.value.integrations.some(i=>(quitApply?['applying']:['preparing','applying']).includes(i.status))) { await quitAndVerify(state.value,'integration');break verification }
      if(state.value.run.status==='blocked') throw Error(state.value.run.blocker)
      await evaluate(`(()=>{const titles=${JSON.stringify(['Fix'])};for(const d of document.querySelectorAll('.team-body > details'))if(d.querySelector('summary')?.textContent.match(/running|awaiting-review|completed|needs-revision/))d.open=true})()`)
      activityVisible ||= await evaluate(`document.body.innerText.includes('Helper activity (read only)')`)
      if(state.value.integrations.some(record=>record.status==='awaiting-approval')) {
        if (!staleApprovalRefused) {
          const pending = state.value.integrations.find(record=>record.status==='awaiting-approval')
          const stale = await evaluate(`window.chorus.team.decideIntegration(${JSON.stringify({runId,integrationId:pending.id,expectedVersion:pending.version-1,clientRequestId:'stale-approval-fixture',decision:'approve'})})`)
          assert.equal(stale.code,'STALE_APPROVAL');staleApprovalRefused=true
          await cdp('Page.reload');await sleep(3000)
          await evaluate(`window.chorus.resizeSession(${JSON.stringify(sessionId)},120,40)`)
          await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Team ·')&&b.getAttribute('aria-expanded')==='false')?.click()`);await sleep(500)
          approvalRendererReload=await evaluate(`document.body.innerText.includes('Review exact prepared changes')`)
          assert(approvalRendererReload,'Pending approval did not survive renderer reload')
        }
        const clicked = await evaluate(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Approve this result'&&!b.disabled);if(!b)return false;b.click();return true})()`)
        approvalViaUi ||= clicked
      }
      if(state.value.tasks.length && state.value.tasks.every(task=>task.status==='completed')) { workflowCompleted=true; break }
      const attached = await evaluate(`window.chorus.attachSession({sessionId:${JSON.stringify(sessionId)},agent:${JSON.stringify(leadId)}})`)
      fs.writeFileSync(path.join(evidence,'workflow-terminal.log'),attached.buffer)
      const tail = await currentScreen(attached.buffer), index = tail.lastIndexOf('Do you want to proceed?'), prefix = index < 0 ? '' : tail.slice(0,index)
      fs.writeFileSync(path.join(evidence,'workflow-screen.txt'),tail)
      if(leadId==='claude' && index>=0 && (prefix!==approvedPrompt || Date.now()-approvedAt>15000) && /(?:node(?:\.exe)?["']?\s+--test|git\s+(?:show|diff|status|rev-parse|ls-tree|log))/.test(prefix) && !/(?:\bpush\b|\breset\b|Remove-Item|Invoke-WebRequest)/.test(prefix)) { approvedPrompt=prefix; approvedAt=Date.now(); await evaluate(`window.chorus.writeSession(${JSON.stringify(sessionId)},${JSON.stringify('\r')})`) }
      await sleep(quitIntegration?25:1500)
    }
    assert(!quitIntegration,'Workflow completed without observing an active integration to interrupt')
    assert(workflowCompleted,'Packaged workflow did not reach accepted integrated verification')
    if(policy==='ask') assert(approvalViaUi,'Ask policy did not receive a visible user approval')
    const finalState = await evaluate(`window.chorus.team.snapshot({runId:${JSON.stringify(runId)},afterSequence:0})`)
    assert(finalState.ok)
    for(const option of helpers)assert(finalState.value.attempts.some(attempt=>attempt.memberId===option.member.id && attempt.status==='succeeded' && attempt.cessation==='confirmed'), 'Selected helper did not complete with confirmed cessation')
    if(helpers.length>1)assert(peakRunningHelpers>=2,'Two native running helpers were not observed concurrently')
    const worktrees = await evaluate(`window.chorus.listWorktrees(${JSON.stringify(project.id)})`)
    const integrated = worktrees.find(worktree=>worktree.id===finalState.value.run.integrationWorktreeId)
    assert(integrated && path.resolve(integrated.path).startsWith(path.resolve(sourceEvidence)+path.sep), 'Integrated acceptance must use the disposable owned worktree')
    const git = (...args)=>execFileSync('git',['-C',integrated.path,...args],{encoding:'utf8',windowsHide:true}).trim()
    assert.equal(git('status','--porcelain'),'','Integrated acceptance requires a clean committed tree')
    const testBlobs={}
    for(const implementation of implementations){
      const expectedBlob=execFileSync('git',['-C',path.join(sourceEvidence,'source'),'rev-parse',`HEAD:${implementation.test}`],{encoding:'utf8',windowsHide:true}).trim()
      assert.equal(git('rev-parse',`HEAD:${implementation.test}`),expectedBlob,'Committed acceptance test changed')
      assert.equal(fs.readFileSync(path.join(integrated.path,implementation.test),'utf8').replace(/\r\n/g,'\n'),implementation.testText,'Acceptance tests changed')
      testBlobs[implementation.test]=expectedBlob
    }
    const verifiedHead=git('rev-parse','HEAD')
    const acceptance=execFileSync(process.execPath,['--test',...implementations.map(item=>item.test)],{cwd:integrated.path,encoding:'utf8',windowsHide:true,timeout:30000})
    fs.writeFileSync(path.join(evidence,'independent-acceptance.log'),acceptance)
    finalAcceptance={verifiedHead,exitCode:0,tests:implementations.map(item=>item.test),testBlobs,peakRunningHelpers,node:process.version,selectedHelperConfirmed:true}
    fs.writeFileSync(path.join(evidence,'independent-acceptance.json'),JSON.stringify(finalAcceptance,null,2))
    for(const implementation of implementations)assert.equal(fs.readFileSync(path.join(sourceEvidence,'source',implementation.file),'utf8'),implementation.initial)
    const verifiedImage=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(evidence,'workflow-complete.png'),Buffer.from(verifiedImage.data,'base64'))
  }
  await evaluate(`document.querySelector('button[aria-label="Close Team view"]')?.click()`); await sleep(400)
  assert(!(await evaluate(`document.querySelector('[aria-label="Team session"]') !== null`)), 'Closing the view did not detach')
  const detached = await evaluate(`window.chorus.team.snapshot({runId:${JSON.stringify(runId)},afterSequence:0})`)
  assert.equal(detached.value.run.status, 'active', 'View detach altered the run')
  const pause = await evaluate(`window.chorus.team.control(${JSON.stringify({ runId, expectedVersion: detached.value.run.version, clientRequestId: 'packaged-pause', action: 'pause' })})`); assert(pause.ok)
  let paused
  for (let i=0;i<30;i++) { paused = await evaluate(`window.chorus.team.snapshot({runId:${JSON.stringify(runId)},afterSequence:0})`); if(paused.value.run.status==='paused') break; await sleep(500) }
  assert.equal(paused.value.run.status, 'paused')
  let dirtyResumeRefused = false, recoveryCheckpoint = false, recoveryOnlyVisible = false
  if (recoveryWorkflow) {
    const rows = await evaluate(`window.chorus.listWorktrees(${JSON.stringify(project.id)})`)
    const integration = rows.find(row=>row.id===paused.value.run.integrationWorktreeId)
    assert(integration && path.resolve(integration.path).startsWith(path.resolve(sourceEvidence)+path.sep))
    const retained = path.join(integration.path,'recovery-note.txt'), contents='Retained user work for the explicit recovery fixture.\n'
    assert(!fs.existsSync(retained)); fs.writeFileSync(retained,contents)
    const refused=await evaluate(`window.chorus.team.control(${JSON.stringify({runId,expectedVersion:paused.value.run.version,clientRequestId:'dirty-resume-refused',action:'resume'})})`)
    assert.equal(refused.code,'RECOVERY_REQUIRED'); dirtyResumeRefused=true
    assert.equal(fs.readFileSync(retained,'utf8'),contents)
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Launch an Agent'))?.click()`);await sleep(400)
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Team session')?.click()`);await sleep(1500)
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Open lead')?.click()`);await sleep(1000)
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Team ·')&&b.getAttribute('aria-expanded')==='false')?.click()`);await sleep(300)
    assert(await evaluate(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Recover retained work');if(!b)return false;b.click();return true})()`))
    let recovering
    for(let i=0;i<90;i++){
      recovering=await evaluate(`window.chorus.team.snapshot({runId:${JSON.stringify(runId)},afterSequence:0})`)
      if(recovering.value.run.status==='recovering'&&recovering.value.events.some(e=>e.operation==='lead-started'&&e.generation===recovering.value.run.generation))break
      await sleep(1000)
    }
    assert.equal(recovering.value.run.status,'recovering')
    assert.equal(recovering.value.run.generation,paused.value.run.generation+1)
    recoveryOnlyVisible=await evaluate(`document.body.innerText.includes('Recovery only')`);assert(recoveryOnlyVisible)
    await sleep(3000)
    const prompt='This is the explicit recovery-only test. Read team_status and inspect recovery-note.txt. Preserve its exact contents. Checkpoint ONLY that file with a local Git commit, using per-command git -c user.name="Recovery Fixture" -c user.email="fixture@localhost" if needed. Do not delete or reset anything, dispatch helpers, integrate, change global configuration or alter other files. Confirm git status --porcelain is empty. Remain in recovery-only mode; the user will explicitly Resume through the Team panel. Git inspection and this one checkpoint are authorized.'
    await evaluate(`window.chorus.writeSession(${JSON.stringify(sessionId)},${JSON.stringify(prompt)})`);await sleep(600);await evaluate(`window.chorus.writeSession(${JSON.stringify(sessionId)},${JSON.stringify('\r')})`)
    let approved='',approvedAt=0
    for(let i=0;i<240;i++){
      const status=execFileSync('git',['-C',integration.path,'status','--porcelain'],{encoding:'utf8',windowsHide:true}).trim()
      if(!status&&execFileSync('git',['-C',integration.path,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim()!==paused.value.run.integrationHead){recoveryCheckpoint=true;break}
      const terminal=await evaluate(`window.chorus.attachSession({sessionId:${JSON.stringify(sessionId)},agent:${JSON.stringify(leadId)}})`),screen=await currentScreen(terminal.buffer)
      fs.writeFileSync(path.join(evidence,'recovery-terminal.log'),terminal.buffer);fs.writeFileSync(path.join(evidence,'recovery-screen.txt'),screen)
      const index=screen.lastIndexOf('Do you want to proceed?'),start=Math.max(screen.lastIndexOf('\n Bash command'),screen.lastIndexOf('\n PowerShell command')),command=index<0?'':screen.slice(start>=0?start:0,index)
      if(leadId==='claude'&&index>=0&&(command!==approved||Date.now()-approvedAt>15000)&&/git\s+(?:status|diff|show|log|add|commit|-c\s)/.test(command)&&!/(?:\breset\b|\bpush\b|\brm\b|Remove-Item)/.test(command)){approved=command;approvedAt=Date.now();await evaluate(`window.chorus.writeSession(${JSON.stringify(sessionId)},${JSON.stringify('\r')})`)}
      await sleep(1000)
    }
    assert(recoveryCheckpoint,'Recovery lead did not checkpoint retained work')
    assert.equal(fs.readFileSync(retained,'utf8'),contents)
    const retainedState=await evaluate(`window.chorus.team.snapshot({runId:${JSON.stringify(runId)},afterSequence:0})`)
    assert.equal(retainedState.value.run.status,'recovering')
    assert.deepEqual(retainedState.value.attempts.map(attempt=>attempt.id).sort(),paused.value.attempts.map(attempt=>attempt.id).sort(),'Recovery must not dispatch new helper attempts')
    fs.writeFileSync(path.join(evidence,'recovery.json'),JSON.stringify(retainedState.value,null,2))
    paused=retainedState
  }
  const resumed = await evaluate(`window.chorus.team.control(${JSON.stringify({ runId, expectedVersion: paused.value.run.version, clientRequestId: 'packaged-resume', action: 'resume' })})`); assert(resumed.ok, JSON.stringify(resumed))
  let latest
  for(let i=0;i<90;i++) { latest=await evaluate(`window.chorus.team.snapshot({runId:${JSON.stringify(runId)},afterSequence:0})`); if(latest.value.run.status==='active'||latest.value.run.status==='blocked') break; await sleep(1000) }
  fs.writeFileSync(path.join(evidence,'resumed.json'),JSON.stringify(latest.value,null,2))
  assert.equal(latest.value.run.status,'active', latest.value.run.blocker)
  assert.equal(latest.value.run.leadSessionId,sessionId)
  assert.equal(latest.value.run.generation,paused.value.run.generation+1)
  const stop = await evaluate(`window.chorus.team.control(${JSON.stringify({ runId, expectedVersion: latest.value.run.version, clientRequestId: 'packaged-stop', action: 'stop' })})`); assert(stop.ok)
  let stopped
  for(let i=0;i<30;i++) { stopped=await evaluate(`window.chorus.team.snapshot({runId:${JSON.stringify(runId)},afterSequence:0})`); if(stopped.value.run.status==='stopped') break; await sleep(1000) }
  assert.equal(stopped.value.run.status,'stopped',stopped.value.run.blocker)
  const ordinaryPresets = []
  if (ordinaryRegression) {
    await evaluate(`document.querySelector('button[aria-label="Close Team view"]')?.click()`)
    for (const [preset, expected] of [['Solo',1],['Pair',2],['Workbench',2],['Swarm',2]]) {
      const before = await evaluate(`window.chorus.getLayout(${JSON.stringify(project.id)})`)
      await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Launch an Agent'))?.click()`); await sleep(2500)
      assert(await evaluate(`(()=>{const b=Array.from(document.querySelectorAll('[data-launch-preset]')).find(b=>b.querySelector('.launch-mode-name')?.textContent.trim().startsWith(${JSON.stringify(preset)}));if(!b||b.disabled)return false;b.click();return true})()`), `${preset} card unavailable`)
      await sleep(300)
      await evaluate(`Array.from(document.querySelectorAll('.launch-agent')).find(b=>b.querySelector('.launch-agent-name')?.textContent.includes('Claude'))?.click()`)
      if (preset==='Solo'||preset==='Swarm') await evaluate(`Array.from(document.querySelectorAll('.launch-body .overlay-segment')).find(b=>b.textContent.trim()===${JSON.stringify(String(expected))})?.click()`)
      await sleep(300)
      const plan = await evaluate(`Array.from(document.querySelectorAll('.launch-plan li')).map(row=>row.textContent.trim())`)
      assert(await evaluate(`(()=>{const b=Array.from(document.querySelectorAll('.launch-foot button')).find(b=>b.textContent.trim()==='Launch');if(!b||b.disabled)return false;b.click();return true})()`), `${preset} Launch unavailable`)
      let added=[]
      try {
        for(let i=0;i<60;i++) {
          const layout=await evaluate(`window.chorus.getLayout(${JSON.stringify(project.id)})`)
          added=layout.sessions.filter(s=>!before.sessions.some(old=>old.id===s.id))
          if(added.length===expected && !(await evaluate(`document.querySelector('.launch-foot')!==null`)))break
          await sleep(500)
        }
        assert.equal(added.length,expected,`${preset} session count`)
        const attached=[]
        for(const session of added) attached.push(await evaluate(`window.chorus.attachSession(${JSON.stringify({sessionId:session.id,agent:session.agent})})`))
        assert(attached.every(s=>s.status==='running'),`${preset} must start live ordinary sessions`)
        if(preset==='Workbench')assert(added.some(s=>s.agent==='shell'),'Workbench includes a shell')
        if(preset==='Pair'||preset==='Workbench')assert.equal(attached[0].worktreeId,attached[1].worktreeId,`${preset} shares a workspace`)
        if(preset==='Swarm')assert(attached.every(s=>s.worktreeId)&&new Set(attached.map(s=>s.worktreeId)).size===2,'Swarm isolates worktrees')
        ordinaryPresets.push({preset,plan,sessions:added,attachments:attached.map(({buffer,...rest})=>rest)})
        fs.writeFileSync(path.join(evidence,'ordinary-presets.json'),JSON.stringify(ordinaryPresets,null,2))
      } finally {
        for(const session of added) await evaluate(`window.chorus.killSession(${JSON.stringify(session.id)})`)
        await evaluate(`window.chorus.setLayout(${JSON.stringify({project_id:project.id,layout:null})})`)
        await cdp('Page.reload');await sleep(3500)
      }
    }
  }
  fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify({ passed: true, runtime: development ? 'development' : 'packaged', executable: exe, isolatedProfile: true, nativeBridgeHandshake: true, lead: leadId, helpers: helpers.map(option=>({key:option.key,harness:option.member.harness,model:option.member.model,authMode:option.member.authMode})), teamPanel: true, ownershipGuards: 7, viewDetached: true, pauseResume: true, generationRotated: true, stopConfirmed: true, workflowCompleted, finalAcceptance, approvalViaUi, staleApprovalRefused, approvalRendererReload, activityVisible, dirtyResumeRefused, recoveryOnlyVisible, recoveryCheckpoint, policy, evidence, at: new Date().toISOString() }, null, 2))
  if(ordinaryRegression||retryActivation||keyboardCheck){const reportPath=path.join(evidence,'report.json'),report=JSON.parse(fs.readFileSync(reportPath,'utf8'));if(ordinaryRegression)report.ordinaryPresets=ordinaryPresets.map(row=>row.preset);if(retryActivation)report.activationRetryVerified=activationRetryVerified;if(keyboardCheck)report.keyboardVerified=keyboardVerified;fs.writeFileSync(reportPath,JSON.stringify(report,null,2))}
  await evaluate('window.chorus.closeWindow()')
} catch (error) { fs.writeFileSync(path.join(evidence, 'failure.json'), JSON.stringify({ message: error.message, stack: error.stack, evidence })); process.exitCode = 1; if (cdp) { try { await cdp('Runtime.evaluate', { expression: 'window.chorus.closeWindow()' }) } catch {} } }
finally { socket?.close(); if(!childExit)await Promise.race([once(child, 'close'), sleep(15000)]); fs.closeSync(log) }
}
const result = path.join(evidence, process.exitCode ? 'failure.json' : 'report.json'); console.log(fs.readFileSync(result, 'utf8'))
