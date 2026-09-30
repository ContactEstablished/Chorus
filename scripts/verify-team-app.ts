import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { StorageService } from '../src/main/services/storage'
import { teamFixtureRun, teamFixtureTask, teamFixtureId as id, TEAM_FIXTURE_TIME as now } from '../src/main/services/teamTestFixtures'
import { reserveNextAttempt, failPreparation, reviseTask } from '../src/main/services/teamCore'
import { copyFixtureCredential } from './team-fixture-credential'
const root = process.cwd(), evidence = process.env.CHORUS_TEAM_APP_EVIDENCE!
const historyFixture = process.env.CHORUS_TEAM_APP_HISTORY === '1'
const credentialRefusal = process.env.CHORUS_TEAM_APP_CREDENTIAL_REFUSAL === '1'
app.setPath('userData', path.join(evidence, 'profile'))
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
app.whenReady().then(async () => {
  const source = path.join(evidence, 'source'); fs.mkdirSync(source)
  execFileSync('git', ['init', '-q', source], { windowsHide: true })
  fs.writeFileSync(path.join(source, 'README.md'), '# Disposable Team UI fixture\n')
  execFileSync('git', ['-C', source, 'add', '.'], { windowsHide: true })
  execFileSync('git', ['-C', source, '-c', 'user.name=Chorus Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Fixture'], { windowsHide: true })
  const storage = new StorageService(path.join(evidence, 'profile', 'chorus.db')), { project } = storage.getOrCreateProject(source)
  const fixtureCredentialProfileId = process.env.CHORUS_TEAM_APP_CREDENTIAL_SOURCE ? copyFixtureCredential(process.env.CHORUS_TEAM_APP_CREDENTIAL_SOURCE, storage) : null
  storage.setActiveProjectId(project.id)
  const memoryUri = process.env.CHORUS_TEAM_APP_MEMORY_URI
  if (memoryUri) {
    assert(/^bolt:\/\/127\.0\.0\.1:\d+$/.test(memoryUri), 'Memory fixture requires a loopback test instance')
    storage.upsertProjectMemory({ projectId: project.id, mode: 'existing', boltUri: memoryUri, databaseName: 'neo4j', authMode: 'none', credentialProfileId: null, containerId: null, containerName: null, volumeName: null, boltPort: null, httpPort: null, schemaVersion: 0, lastSeededAt: null, createdAt: now, updatedAt: now })
  }
  if(credentialRefusal) {
    storage.createSession({id:id(81),projectId:project.id,agent:'claude',cwd:source,status:'running',createdAt:now,launchProfileId:id(82),name:'Credentialed ordinary restore fixture'})
    storage.savePaneLayout(project.id,{version:1,root:{type:'leaf',sessionId:id(81)}})
  }
  if(historyFixture) {
    const teams=storage.createTeamStorage(),run={...teamFixtureRun(),projectId:project.id,leadSessionId:id(80),integrationWorktreeId:null}
    storage.createSession({id:id(80),projectId:project.id,agent:'claude',cwd:source,status:'exited',createdAt:now,exitCode:0,name:'Retained history fixture'})
    teams.createRun(run,'history-fixture',{},id(100))
    let event=101
    const command=(operation:string)=>({runId:run.id,generation:1,actor:'system' as const,operation,eventId:id(event++),now})
    const initial=teamFixtureTask()
    teams.command(command('fixture-task'),tx=>{tx.writeTask(initial);return{acknowledgment:{},event:{}}})
    for(let number=1;number<=3;number++) {
      let task=teams.tasks(run.id)[0]
      if(number>1){const revised=reviseTask(run,task,teams.attempts(run.id),task.command.memberId,'Explicit fixture revision',now);teams.command(command('fixture-revise'),tx=>{tx.writeTask(revised,task.version);return{acknowledgment:{},event:{}}});task=revised}
      const reserved=reserveNextAttempt(run,[task],teams.attempts(run.id),id(200+number),now)!
      teams.command(command('fixture-reserve'),tx=>{tx.writeAttempt(reserved.attempt);tx.writeTask(reserved.task,task.version);return{acknowledgment:{},event:{}}})
      const failed=failPreparation(run,reserved.task,reserved.attempt,now,'Deterministic preparation failure; no helper was spawned.')
      teams.command(command('fixture-fail'),tx=>{tx.writeTask(failed.task,reserved.task.version);tx.writeAttempt(failed.attempt,reserved.attempt.version);return{acknowledgment:{},event:{}}})
    }
    assert.throws(()=>reviseTask(run,teams.tasks(run.id)[0],teams.attempts(run.id),initial.command.memberId,'Fourth attempt',now),/exhausted/)
    teams.command(command('fixture-stopped'),tx=>{tx.updateRun(run.version,{...run,status:'stopped',version:run.version+1});return{acknowledgment:{},event:{}}})
  }
  storage.close()
  if (process.env.CHORUS_TEAM_APP_PREPARE_ONLY === '1') {
    fs.writeFileSync(path.join(evidence, 'fixture-prepared.json'), JSON.stringify({ fixturePrepared: true, applicationVerified: false, evidence, projectId: project.id, fixtureCredentialProfileId, historyFixture, credentialRefusal, memoryUri: memoryUri ?? null }))
    app.quit(); return
  }
  require(path.join(root, 'out/main/index.js'))
  let window: BrowserWindow | undefined
  for (let i = 0; i < 120; i++) { window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('renderer/index.html')); if (window && !window.webContents.isLoading()) break; await sleep(500) }
  assert(window, 'Main application window did not load')
  const evaluate = (code: string) => window!.webContents.executeJavaScript(code, true)
  await sleep(4000)
  if(credentialRefusal) {
    const layout=await evaluate(`window.chorus.getLayout(${JSON.stringify(project.id)})`)
    assert.equal(layout.sessions.find((row:{id:string})=>row.id===id(81))?.status,'exited')
    const attached=await evaluate(`window.chorus.attachSession({sessionId:${JSON.stringify(id(81))},agent:'claude'})`)
    assert.equal(attached.status,'exited');assert.equal(attached.buffer,'')
    assert(fs.readFileSync(path.join(evidence,'app.log'),'utf8').includes(`credentialed session healed -> exited (no keyless restore): ${id(81)}`))
    fs.writeFileSync(path.join(evidence,'credentialed-restore.png'),(await window.capturePage()).toPNG())
    // Retain the historical row, detach its view, then continue the launch/history UI drive.
    await evaluate(`window.chorus.setLayout(${JSON.stringify({project_id:project.id,layout:null})})`)
    window.webContents.reload();await sleep(3000)
  }
  const api = await evaluate(`({ team: typeof window.chorus.team, title: document.title, text: document.body.innerText.slice(0,2000) })`)
  assert.equal(api.team, 'object')
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Launch an Agent'))?.click()`)
  await sleep(500)
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Team session')?.click()`)
  for (let i = 0; i < 30; i++) { if (await evaluate(`document.body.innerText.includes('Launch team')`)) break; await sleep(500) }
  assert(await evaluate(`document.querySelector('[aria-labelledby="team-launch-title"]') !== null`))
  const text = await evaluate('document.body.innerText')
  assert(text.includes('Concurrent helpers')); assert(text.includes('The lead reviews and applies helper work automatically')); assert(text.includes('Subscription spend is unknown'))
  fs.writeFileSync(path.join(evidence, 'team-launch.png'), (await window.capturePage()).toPNG())
  window.setSize(900, 650); await sleep(400)
  fs.writeFileSync(path.join(evidence, 'team-launch-small.png'), (await window.capturePage()).toPNG())
  const caps = await evaluate(`window.chorus.team.capabilities({projectId:${JSON.stringify(project.id)}})`)
  assert(caps.ok); assert(caps.value.options.some((o: { enabled: boolean }) => o.enabled))
  if (fixtureCredentialProfileId) assert(caps.value.options.some((o: { key: string; enabled: boolean }) => o.key === fixtureCredentialProfileId && o.enabled), 'Selected API helper is unavailable in the actual application')
  const config = { schemaVersion: 1, baseRevision: 'HEAD', lead: caps.value.options.find((o: { lead: boolean; enabled: boolean }) => o.lead && o.enabled).member, helpers: [{ ...caps.value.options.find((o: { enabled: boolean }) => o.enabled).member, id: crypto.randomUUID() }], concurrency: 2, executionMinutes: 30, integrationPolicy: 'ask' }
  const saved = await evaluate(`window.chorus.team.presetSave(${JSON.stringify({ projectId: project.id, expectedVersion: null, label: 'UI fixture', config })})`)
  assert(saved.ok); assert.equal(saved.value[0].version, 1)
  const stale = await evaluate(`window.chorus.team.presetDelete(${JSON.stringify({ projectId: project.id, id: saved.value[0].id, expectedVersion: 2 })})`)
  assert.equal(stale.code, 'STALE_VERSION')
  window.webContents.reload(); await sleep(3000)
  const retained = await evaluate(`window.chorus.team.presetList({projectId:${JSON.stringify(project.id)}})`)
  assert(retained.ok); assert.equal(retained.value[0].label, 'UI fixture')
  if(historyFixture) {
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Launch an Agent'))?.click()`);await sleep(400)
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Team session')?.click()`);await sleep(1200)
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Open lead')?.click()`);await sleep(1200)
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Team ·'))?.click()`);await sleep(300)
    await evaluate(`for(const details of document.querySelectorAll('.team-body details'))details.open=true`)
    const panel=await evaluate(`document.querySelector('[aria-label="Team session"]')?.innerText`)
    fs.writeFileSync(path.join(evidence,'history-ui.txt'),await evaluate('document.body.innerText'))
    fs.writeFileSync(path.join(evidence,'exhausted-history.png'),(await window.capturePage()).toPNG())
    assert(panel?.includes('Attempts: 3 / 3'));assert(panel.includes('This task has used all three attempts'))
    const state=await evaluate(`window.chorus.team.snapshot({runId:${JSON.stringify(id(1))},afterSequence:0})`)
    assert.equal(state.value.attempts.length,3);assert.equal(state.value.run.status,'stopped')
    const terminal=await evaluate(`window.chorus.attachSession({sessionId:${JSON.stringify(id(80))},agent:'claude'})`);assert.equal(terminal.status,'exited')
    fs.writeFileSync(path.join(evidence,'exhausted-history.png'),(await window.capturePage()).toPNG())
  }
  fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify({ passed: true, profile: 'isolated', fixtureCredentialProfileId, apiHelperAvailable: fixtureCredentialProfileId !== null, rendererApi: true, launchDialog: true, smallWindow: true, plainPresetSave: true, stalePresetRefused: true, rendererReload: true, exhaustedHistory:historyFixture, historyFixture:historyFixture?'deterministic core transitions; no helper processes':null, ordinaryCredentialRestoreRefused:credentialRefusal, realLeadFlow: 'separate production verifier', evidence, at: new Date().toISOString() }, null, 2))
  app.quit()
}).catch(error => { fs.writeFileSync(path.join(evidence, 'failure.json'), JSON.stringify({ message: error.message, stack: error.stack })); app.quit() })
