import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { once } from 'node:events'
const require = createRequire(import.meta.url), root = process.cwd()
const mixedPilot = process.argv.includes('--mixed-pilot')
const controlled = process.argv.includes('--controlled')
if (controlled && process.argv.some(arg => arg === '--resume' || arg === '--mixed-pilot' || arg.startsWith('--pilot'))) throw Error('Controlled evaluation requires a new complete 18-execution batch')
const credentialSource = mixedPilot ? fs.readFileSync(path.join(root,'_verify','phase11-council-profile.txt'),'utf8').trim() : null
const resumeAt=process.argv.indexOf('--resume'),resume=resumeAt>=0
const batch = resume ? path.resolve(process.argv[resumeAt+1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-team-evaluation-'))
if(resume&&(!batch.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(batch).startsWith('chorus-team-evaluation-')))throw Error('Resume requires the retained disposable evaluation directory')
const previousManifest=resume?JSON.parse(fs.readFileSync(path.join(batch,'manifest.json'),'utf8')):null
const bundle = path.join(root, '_verify', `team-evaluation-${Date.now()}.cjs`), fixturesBundle = path.join(root, '_verify', `team-evaluation-fixtures-${Date.now()}.cjs`)
await require('esbuild').build({entryPoints:['scripts/team-evaluation-fixtures.ts'],outfile:fixturesBundle,bundle:true,platform:'node',format:'cjs'})
const implementationBuild = await require('esbuild').build({entryPoints:['scripts/verify-team-evaluation.ts'],outfile:bundle,bundle:true,platform:'node',format:'cjs',packages:'external',metafile:true})
const fileHash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const frozenBridge = path.join(batch, 'teamBridge.cjs')
if (!resume) fs.copyFileSync(path.join(root, 'resources/teamBridge.cjs'), frozenBridge)
const implementationHashes = Object.fromEntries([...Object.keys(implementationBuild.metafile.inputs), 'resources/teamBridge.cjs', 'package-lock.json'].sort().map(file => [file, fileHash(path.resolve(root, file))]))
const cliVersions = () => Object.fromEntries(['claude', 'codex'].map(cli => [cli, execFileSync('cmd.exe', ['/d', '/s', '/c', `${cli} --version`], { encoding: 'utf8', windowsHide: true }).trim()]))
const frozenVersions = controlled ? cliVersions() : null
const assertFrozen = () => {
  if (!controlled) return
  for (const [file, expected] of Object.entries(implementationHashes)) if (fileHash(path.resolve(root, file)) !== expected) throw Error(`Controlled implementation changed during evaluation: ${file}`)
  if (fileHash(bundle) !== bundleHash || fileHash(frozenBridge) !== implementationHashes['resources/teamBridge.cjs']) throw Error('Frozen executable bundle or bridge changed')
  if (JSON.stringify(cliVersions()) !== JSON.stringify(frozenVersions)) throw Error('Installed CLI versions changed during the controlled batch')
}
const { evaluationFixtures } = require(fixturesBundle)
const sha = text => createHash('sha256').update(text.replace(/\r\n/g,'\n')).digest('hex')
const frozen = []
for(const fixture of resume?[]:evaluationFixtures) {
  const source = path.join(batch,'frozen',fixture.id); fs.mkdirSync(source,{recursive:true})
  for(const [name,text] of Object.entries(fixture.files)) fs.writeFileSync(path.join(source,name),text)
  execFileSync('git',['init','-q',source],{windowsHide:true})
  execFileSync('git',['-C',source,'add','.'],{windowsHide:true})
  execFileSync('git',['-C',source,'-c','user.name=Evaluation','-c','user.email=evaluation@localhost','commit','-qm','Frozen independent evaluation fixture'],{windowsHide:true})
  const baseSha=execFileSync('git',['-C',source,'rev-parse','HEAD'],{windowsHide:true,encoding:'utf8'}).trim()
  frozen.push({fixture:{id:fixture.id,title:fixture.title,brief:fixture.brief,editable:fixture.editable},frozenSource:source,baseSha,fileHashes:Object.fromEntries(Object.entries(fixture.files).map(([name,text])=>[name,sha(text)]))})
}
const plans = resume ? previousManifest.plans : []
for(const fixture of frozen)for(let pair=1;pair<=3;pair++){
  const conditions=pair%2===1?['lead-only','team']:['team','lead-only']
  for(let order=0;order<conditions.length;order++)plans.push({...fixture,pair,condition:conditions[order],order:order+1,deadlineMs:360000,roster:['claude','codex']})
}
const manifest=previousManifest??{schemaVersion:1,frozenAt:new Date().toISOString(),lead:{harness:'claude',model:'sonnet',effort:null,authMode:'subscription'},roster:['claude','codex'],policy:'lead-integrates',concurrency:2,deadlineMs:360000,plans,environment:{platform:process.platform,node:process.version,computer:os.hostname()},limitations:['Single Windows machine and CLI-managed accounts.','No claim of subscription billed cost.','Native production composition; UI launch time excluded equally.','Automated bounded trust/command approvals recorded separately from human intervention.']}
const bundleHash=createHash('sha256').update(fs.readFileSync(bundle)).digest('hex')
if (controlled) {
  manifest.controlled = { singleBuild: true, sequentialExecutions: true, intentionalConcurrentBuildsOrModelTests: false, sourceHashes: implementationHashes, bridgeSha256: fileHash(frozenBridge), cliVersions: frozenVersions, limitation: 'Normal operating-system and user background activity is not disabled; CPU observations are retained, not a claim of exclusive machine use.' }
  manifest.environment.cpu = os.cpus()[0]?.model ?? null
  manifest.environment.logicalProcessors = os.cpus().length
  manifest.environment.totalMemory = os.totalmem()
  manifest.environment.release = os.release()
}
const results=resume?JSON.parse(fs.readFileSync(path.join(batch,'results.json'),'utf8')).results:[]
if(resume){
 if(!process.argv.includes('--amend-retirement'))throw Error('Resuming with a rebuilt verifier requires an explicit recorded amendment')
 manifest.amendments??=[];manifest.amendments.push({at:new Date().toISOString(),afterExecutions:results.length,bundle,bundleSha256:bundleHash,reason:'Confirmed exited descendants are now durably retired from active ownership observations; unknown or recycled unretired identities still block. Baseline teardown gains bounded reinspection. Existing results, including failed cleanup, are retained without reruns. Fixtures, model/auth/roster, order and measured deadlines are unchanged. Controller-input counter naming is clarified; it is not measured human participation.'})
}else{
 manifest.executionMode=mixedPilot?'mixed-auth-matrix':process.argv.some(a=>a.startsWith('--pilot'))?'pilot':'formal-18'
 manifest.bundleSha256=bundleHash
 manifest.fixtureBundleSha256=createHash('sha256').update(fs.readFileSync(fixturesBundle)).digest('hex')
}
fs.writeFileSync(path.join(batch,'manifest.json'),JSON.stringify(manifest,null,2))
console.log(JSON.stringify({batch,runs:plans.length,bundle,frozenAt:manifest.frozenAt}))
const maximum=process.argv.includes('--pilot-baseline')?1:process.argv.includes('--pilot')?2:plans.length
for(const original of mixedPilot ? plans.filter(p=>p.fixture.id==='parallel-feature'&&p.pair===1&&p.condition==='team') : process.argv.includes('--pilot-team') ? plans.slice(1,2) : plans.slice(0,maximum)){
  assertFrozen()
  if(results.some(r=>r.fixture===original.fixture.id&&r.pair===original.pair&&r.condition===original.condition))continue
  const plan = mixedPilot ? {...original,roster:['claude','opencode-api'],matrixVerification:'mixed-auth-roster',deadlineMs:600000} : original
  const evidence=path.join(batch,`${plan.fixture.id}-pair${plan.pair}-${plan.condition}`);fs.mkdirSync(evidence)
  fs.writeFileSync(path.join(evidence,'plan.json'),JSON.stringify(plan,null,2))
  const env={...process.env,CHORUS_EVALUATION_EVIDENCE:evidence};delete env.ELECTRON_RUN_AS_NODE
  if (controlled) env.CHORUS_EVALUATION_BRIDGE = frozenBridge
  if(credentialSource){fs.mkdirSync(path.join(evidence,'profile'));fs.copyFileSync(path.join(credentialSource,'Local State'),path.join(evidence,'profile','Local State'));env.CHORUS_TEAM_FIXTURE_CREDENTIAL_SOURCE=path.join(credentialSource,'chorus.db')}
  // Baseline and Team get the same clean subscription environment at the fixture process boundary.
  for(const name of Object.keys(env))if(/(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN|CHORUS_TEAM_TOKEN|CHORUS_TEAM_ENDPOINT)$/i.test(name))delete env[name]
  const log=fs.openSync(path.join(evidence,'app.log'),'w')
  const environmentStart = { at: new Date().toISOString(), freeMemory: os.freemem(), cpus: os.cpus().map(cpu => cpu.times) }
  const child=spawn(require('electron'),[bundle],{cwd:root,env,windowsHide:true,stdio:['ignore',log,log]})
  fs.writeFileSync(path.join(batch,'active.json'),JSON.stringify({evidence,pid:child.pid,plan:plan.fixture.id,condition:plan.condition,startedAt:new Date().toISOString()},null,2))
  console.log(JSON.stringify({started:evidence,pid:child.pid}))
  const [code,signal]=await once(child,'close');fs.closeSync(log)
  fs.writeFileSync(path.join(evidence,'machine-observation.json'),JSON.stringify({start:environmentStart,end:{at:new Date().toISOString(),freeMemory:os.freemem(),cpus:os.cpus().map(cpu=>cpu.times)}},null,2))
  const file=path.join(evidence,'report.json')
  const result=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{fixture:plan.fixture.id,pair:plan.pair,condition:plan.condition,evidence,passed:false,failure:'Verifier exited without a report',code,signal}
  result.verifierExitCode=code;result.verificationBundleSha256=bundleHash;results.push(result)
  fs.writeFileSync(path.join(batch,'results.json'),JSON.stringify({manifest:'manifest.json',results,complete:results.length===18,at:new Date().toISOString()},null,2))
  fs.writeFileSync(path.join(batch,'active.json'),JSON.stringify({terminal:true,lastEvidence:evidence,at:new Date().toISOString()}))
  assertFrozen()
  console.log(JSON.stringify({finished:evidence,passed:result.passed,elapsedMs:result.elapsedMs,failure:result.failure,code}))
  if(code!==0 || result.shutdownConfirmed===false){console.error('Batch stopped because verifier or owned-process cleanup failed. Remaining executions are not counted.');process.exitCode=1;break}
}
console.log(JSON.stringify({batch,executions:results.length,passed:results.filter(r=>r.passed).length,complete:results.length===18}))
