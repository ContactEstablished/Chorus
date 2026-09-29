import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-team-process-'))
const bundle = path.join(root, '_verify', `team-process-${Date.now()}.cjs`)
await require('esbuild').build({ stdin: { contents: `export { HelperProcess, windowsHelperPlatform } from './src/main/services/helperProcess'; export { createHelperParser } from './src/main/adapters/helpers/parser';`, resolveDir: root, loader: 'ts' }, outfile: bundle, bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
const { HelperProcess, createHelperParser, windowsHelperPlatform } = require(bundle)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let assertions = 0
const check = fn => { fn(); assertions++ }
const active = new Set()
const worker = path.join(evidence, 'worker.cjs')
fs.writeFileSync(worker, String.raw`const fs=require('fs'),{spawn}=require('child_process');const mode=process.argv[2];const send=e=>process.stdout.write(JSON.stringify(e)+'\n');send({type:'system',subtype:'init',session_id:'fixture'});if(mode==='normal'){setTimeout(()=>{const line=JSON.stringify({type:'result',subtype:'success',is_error:false,result:'Secret '+process.env.OPENAI_API_KEY,usage:{}})+'\n';const at=line.indexOf(process.env.OPENAI_API_KEY)+5;process.stdout.write(line.slice(0,at));setTimeout(()=>{process.stdout.write(line.slice(at));process.exit(0)},40)},1800)}else if(mode==='malformed'){setTimeout(()=>process.stdout.write('broken\n'),1200);setInterval(()=>{},1000)}else if(mode==='unknown'){setTimeout(()=>{send({type:'result',subtype:'success',is_error:false,result:'Done',usage:{}});process.exit(0)},1800)}else{spawn(process.execPath,['-e',"setInterval(()=>require('fs').writeFileSync('tick.txt',String(Date.now())),100)"],{stdio:'ignore'});setInterval(()=>{},1000)}`)
async function run(mode, executionMs = 15000, platform) {
  const cwd = path.join(evidence, mode); fs.mkdirSync(cwd)
  const events = [], secret = 'fixture-selected-credential-123456789'
  let fences = 0
  const request = { executable: process.execPath, args: [worker, mode], cwd, envAdditions: {}, secretEnv: { OPENAI_API_KEY: secret }, stdin: 'fixture prompt\n', parserKind: 'claude', permission: { mode: 'fixture', cooperative: true, nativeDelegation: 'disabled' } }
  let journalAvailable = mode !== 'cancel'
  const helper = new HelperProcess({ request, parser: createHelperParser('claude'), executionMs, pollMs: 300, platform, onEvent: e => events.push(e), authorizeSpawn: () => { fences++ }, onTerminationIntent: () => { if (!journalAvailable) throw Error('Injected unavailable cancellation journal') } })
  active.add(helper)
  check(() => assert.equal(fences, 1)); check(() => assert.deepEqual(request.secretEnv, {})); check(() => assert.equal(request.stdin, ''))
  if (mode === 'cancel') {
    await helper.identified; await delay(1200)
    check(() => assert.ok(helper.inspect().descendants.length >= 1))
    await assert.rejects(helper.cancel(), /unavailable cancellation journal/); assertions++
    check(() => assert.equal(helper.inspect().intent, null)); check(() => assert.equal(helper.inspect().cessation, 'live'))
    journalAvailable = true
    await helper.cancel()
  }
  const outcome = await helper.done
  active.delete(helper)
  fs.writeFileSync(path.join(evidence, `${mode}.json`), JSON.stringify({ outcome, events }, null, 2))
  check(() => assert.ok(!JSON.stringify({ outcome, events }).includes(secret)))
  if (mode === 'unknown') { check(() => assert.equal(outcome.cessation, 'unknown')); return }
  check(() => assert.equal(outcome.cessation, 'confirmed'))
  if (mode === 'normal') { check(() => assert.equal(outcome.exitCode, 0)); check(() => assert.equal(outcome.result.isError, false)); check(() => assert.match(outcome.result.summary, /redacted/i)) }
  else if (mode === 'malformed') { check(() => assert.equal(outcome.protocolError, true)); check(() => assert.equal(outcome.intent, null)) }
  else {
    check(() => assert.equal(outcome.intent, mode === 'cancel' ? 'cancelled' : 'timed-out'))
    const tick = path.join(cwd, 'tick.txt'), stopped = fs.readFileSync(tick, 'utf8'); await delay(1000)
    check(() => assert.equal(fs.readFileSync(tick, 'utf8'), stopped))
  }
}
try {
  const retirementWorker=path.join(evidence,'retirement-worker.cjs')
  fs.writeFileSync(retirementWorker,`setTimeout(()=>{console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'Done',usage:{}}));process.exit(0)},9000)`)
  let disposalScans=0, disposalUnknown=false
  const disposalPlatform={async inspect(pid,known){disposalScans++;if(disposalUnknown)throw Error('Injected live inspection uncertainty');return windowsHelperPlatform.inspect(pid,known)},stop:windowsHelperPlatform.stop}
  const disposal=new HelperProcess({request:{executable:process.execPath,args:[retirementWorker],cwd:evidence,envAdditions:{},secretEnv:{},stdin:'',parserKind:'claude',permission:{}},parser:createHelperParser('claude'),executionMs:1500,pollMs:100,platform:disposalPlatform,onEvent(){},authorizeSpawn(){}})
  active.add(disposal);const disposalRoot=await disposal.identified;disposalUnknown=true;await disposal.dispose()
  const scansAfterDispose=disposalScans;await delay(1800)
  check(()=>assert.equal(disposalScans,scansAfterDispose,'Disposed live helper must not keep polling or fire its deadline'))
  check(()=>assert.equal(disposal.inspect().cessation,'unknown'))
  // Fixture alone retained the proven identity for cleanup; production keeps its durable blocker.
  await windowsHelperPlatform.stop([disposalRoot]);const disposedOutcome=await disposal.done
  const scansAfterExit=disposalScans;await delay(3400)
  check(()=>assert.equal(disposedOutcome.cessation,'unknown'))
  check(()=>assert.equal(disposalScans,scansAfterExit,'A later exit must not restart disposed helper reconciliation'))
  active.delete(disposal)
  fs.writeFileSync(path.join(evidence,'disposed-live-helper.json'),JSON.stringify({scansAfterDispose,uncertaintyRetained:true},null,2))
  let retirementScans=0, reusedRetiredPid=false
  const observations=[]
  const retirementPlatform={
    async inspect(pid,known){
      const native=await windowsHelperPlatform.inspect(pid,known.filter(p=>p.pid!==2147483000));retirementScans++
      if(retirementScans===1&&native.root)return {...native,identities:[...native.identities,{pid:2147483000,creationTime:String(BigInt(native.root.creationTime)+100n),executable:'fixture-retired-descendant.exe'}]}
      if(retirementScans>2&&known.some(p=>p.pid===2147483000)){reusedRetiredPid=true;return {...native,uncertain:true}}
      return native
    },
    async stop(identities){assert(!identities.some(p=>p.pid===2147483000));await windowsHelperPlatform.stop(identities)}
  }
  const retirement=new HelperProcess({request:{executable:process.execPath,args:[retirementWorker],cwd:evidence,envAdditions:{},secretEnv:{},stdin:'',parserKind:'claude',permission:{}},parser:createHelperParser('claude'),executionMs:20000,pollMs:300,platform:retirementPlatform,onEvent(){},authorizeSpawn(){},onProcessObservation(_root,descendants){observations.push(descendants)}})
  active.add(retirement);const retiredOutcome=await retirement.done
  check(()=>assert.equal(retiredOutcome.cessation,'confirmed'))
  check(()=>assert.equal(reusedRetiredPid,false))
  check(()=>assert.ok(observations.some(rows=>rows.some(p=>p.pid===2147483000))))
  check(()=>assert.ok(observations.length>1&&!observations.at(-1).some(p=>p.pid===2147483000)))
  await retirement.dispose();active.delete(retirement)
  fs.writeFileSync(path.join(evidence,'retired-descendant.json'),JSON.stringify({injectedRetiredPid:true,observations,outcome:retiredOutcome},null,2))
  const lateWorker = path.join(evidence, 'late-worker.cjs')
  fs.writeFileSync(lateWorker, `const fs=require('fs'),{spawn}=require('child_process');const child=spawn(process.execPath,['-e','setTimeout(()=>process.exit(0),25000)'],{stdio:'ignore',detached:true,windowsHide:true});fs.writeFileSync('late-child.json',JSON.stringify({pid:child.pid,at:Date.now()}));child.unref();setTimeout(()=>{console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'Done',usage:{}}));process.exit(0)},6500)`)
  let confirmed = 0, publications = 0
  const late = new HelperProcess({ request: { executable: process.execPath, args: [lateWorker], cwd: evidence, envAdditions: {}, secretEnv: {}, stdin: '', parserKind: 'claude', permission: {} }, parser: createHelperParser('claude'), executionMs: 30000, pollMs: 300, onEvent() {}, authorizeSpawn() {}, onCessationConfirmed() { publications++; if(publications===1)throw Error('Injected durable cessation-publication failure'); confirmed++ } })
  active.add(late); await late.identified
  const lateOutcome = await late.done
  fs.writeFileSync(path.join(evidence, 'late-outcome.json'), JSON.stringify(lateOutcome, null, 2))
  check(() => assert.equal(lateOutcome.cessation, 'unknown'))
  check(() => assert.ok(lateOutcome.descendants.length > 0))
  check(() => assert.equal(confirmed, 0))
  const lateDeadline = Date.now() + 25000
  while (!confirmed && Date.now() < lateDeadline) await delay(200)
  check(() => assert.equal(confirmed, 1))
  check(() => assert.equal(publications, 2))
  check(() => assert.equal(late.inspect().cessation, 'confirmed'))
  check(() => assert.equal(lateOutcome.cessation, 'unknown'))
  await late.dispose(); active.delete(late)
  await run('normal'); await run('cancel'); await run('timeout', 2200); await run('malformed')
  await run('unknown', 15000, { inspect: async () => { throw Error('Injected unknown identity') }, stop: windowsHelperPlatform.stop })
  let fences = 0
  check(() => assert.throws(() => new HelperProcess({ request: { executable: process.execPath, args: [], cwd: evidence, envAdditions: {}, secretEnv: {}, stdin: '', parserKind: 'claude', permission: {} }, parser: createHelperParser('claude'), executionMs: 1000, onEvent() {}, authorizeSpawn() { fences++; throw Error('Revoked before spawn') } }), /Revoked/))
  check(() => assert.equal(fences, 1))
  console.log(JSON.stringify({ passed: true, assertions, evidence, node: process.version }))
} catch (error) { console.error(JSON.stringify({ passed: false, error: error.message, evidence })); process.exitCode = 1 }
finally { await Promise.allSettled([...active].map(h => h.dispose())); fs.unlinkSync(bundle) }
