import { defaultTeamHelperModel } from '../src/shared/teamProfiles'
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { StorageService } from '../src/main/services/storage'
import { SessionManager } from '../src/main/services/sessionManager'
import { CredentialVault } from '../src/main/services/vault'
import { GitWorktreeManager } from '../src/main/services/worktrees'
import { TeamRuntime } from '../src/main/services/teamRuntime'
import { copyFixtureCredential } from './team-fixture-credential'
import { TEAM_LIMITS } from '../src/shared/team'
import type { TeamSnapshot } from '../src/shared/team'
import { createLongFixture } from './team-long-fixture'
import { createExtendedFixture } from './team-extended-fixture'
import { installTeamLocalChecks, boundedTeamGroups } from './team-local-check-fixture'
import { summarizeTeamLeadTranscript, summarizeTeamAttemptTimings } from '../src/main/services/teamLeadUsageCore'
import { findCodexPilotTranscript, summarizeCodexPilotTranscript } from './team-codex-audit'
import { opencodeHelper } from '../src/main/adapters/helpers/opencode'
;(globalThis as any).self = globalThis
const { Terminal } = require('@xterm/xterm') as typeof import('@xterm/xterm')
const evidence = process.env.CHORUS_TEAM_PILOT_EVIDENCE!, solo = process.env.CHORUS_TEAM_PILOT_SOLO === '1'
const workload = process.env.CHORUS_TEAM_PILOT_WORKLOAD ?? 'small'
const bounded = process.env.CHORUS_TEAM_PILOT_BOUNDED === '1', submissionLimitSeconds = bounded ? 1800 : 900
const leadKey = process.env.CHORUS_TEAM_PILOT_LEAD ?? 'claude-opus', codexLead = leadKey.startsWith('codex')
const recoveryControl = process.env.CHORUS_TEAM_PILOT_RECOVERY_CONTROL === '1'
const leadContext = process.env.CHORUS_TEAM_PILOT_CONTEXT === 'focused' ? 'focused' : 'standard'
app.setPath('userData', path.join(evidence, 'profile'))
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const write = (name: string, value: unknown) => fs.writeFileSync(path.join(evidence, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2))
const executionIdentity = { bundleSha256: createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'), bridgeSha256: createHash('sha256').update(fs.readFileSync(path.resolve('resources/teamBridge.cjs'))).digest('hex') }
write('execution-identity.json', executionIdentity)
const helperLaunches: unknown[] = [], nativeHelperBuild = opencodeHelper.buildExecution
opencodeHelper.buildExecution = input => {
  const request = nativeHelperBuild(input)
  helperLaunches.push({ attemptId: input.attemptId, model: input.model, installedVersion: input.installedVersion ?? null, effort: input.effort ?? null, outputCap: request.envAdditions.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX ?? 'native-default', boundedSystemPrompt: JSON.parse(request.envAdditions.OPENCODE_CONFIG_CONTENT).agent?.build?.prompt?.includes('CHORUS BOUNDED HELPER') ?? false })
  write('helper-launches.json', helperLaunches)
  return request
}
// Observe the actual production PTY call. Never persist the full environment or
// MCP arguments: only discovery names and non-secret configuration projections.
const nativePty = require('node-pty') as typeof import('node-pty'), nativeSpawn = nativePty.spawn
nativePty.spawn = (file, args, options) => {
  const argv = Array.isArray(args) ? args : [], env = options?.env ?? {}
  const keys = ['PATH', 'SystemRoot', 'PATHEXT', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'NODE_REPL_NODE_PATH']
  const discovery = Object.fromEntries(keys.map(name => { const key = Object.keys(env).find(k => k.toUpperCase() === name.toUpperCase()); return [name, key ? env[key] : null] }))
  const instructions = argv.find(arg => arg.startsWith('developer_instructions='))
  const configurations = argv.filter(arg => /^(model_reasoning_effort|sandbox_mode|approval_policy|windows\.sandbox|features\.multi_agent|mcp_servers\.chorus-team\.tool_timeout_sec)=/.test(arg))
  write('launch.json', { executable: file, cwd: options?.cwd, configurations, noDaemon: argv.includes('--no-daemon'), model: argv[argv.indexOf('-m') + 1], instructions: instructions ? { characters: instructions.length, sha256: createHash('sha256').update(instructions).digest('hex'), teamContractPresent: instructions.includes('CHORUS TEAM SESSION') } : null, discovery })
  return nativeSpawn(file, args, options)
}
app.whenReady().then(async () => {
  const root = path.join(evidence, 'source'); fs.mkdirSync(root)
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim()
  git('init', '-q', '-b', 'main'); git('config', 'core.autocrlf', 'false')
  const goal = 'Implement two independent CommonJS modules. slug.cjs exports slug(text): trim, lowercase ASCII, replace every run of non-alphanumeric characters with a single hyphen, strip leading/trailing hyphens; empty or all punctuation returns empty string. order.cjs exports order(items): return a new array sorted by ascending numeric rank, preserve original order for ties, and never mutate the input or its objects. ' + (workload === 'substantial' ? 'Additional slug.cjs exports: slugParts(text) returns the nonempty canonical slug components as a new array; uniqueSlugs(texts) returns canonical names in input order, empty names use item, and globally avoids collisions by trying base, base-2, base-3 etc until unused (including collisions with names that already contain suffixes). Never mutate texts. ASCII-only canonicalization means non-ASCII letters such as the Kelvin sign are separators, not transliterated ASCII. Additional order.cjs exports: rankRows(items) sorts finite numeric ranks ascending, preserves ties, and puts all other ranks (including missing, null, strings, NaN and infinities) last in original order. groupRows(items) returns [{key,items}] groups in first-seen key order using each row.group string (including __proto__ and constructor), with each group sorted by rankRows. Functions return fresh arrays and preserve input objects and frozen inputs. ' : '') + 'Only slug.cjs and order.cjs are editable. Preserve acceptance.test.cjs, package.json, package-lock.json and .gitignore byte-for-byte. No dependencies, native subagents, nested agents, pushes, or edits outside this disposable fixture.'
  fs.writeFileSync(path.join(root, 'slug.cjs'), 'exports.slug=text=>text;\n'); fs.writeFileSync(path.join(root, 'order.cjs'), 'exports.order=items=>items;\n')
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\nout/\n')
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'chorus-team-pilot', version: '1.0.0', scripts: { test: 'node --test', typecheck: 'node --check slug.cjs && node --check order.cjs', build: 'node --check slug.cjs && node --check order.cjs' } }, null, 2))
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ name: 'chorus-team-pilot', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'chorus-team-pilot', version: '1.0.0' } } }))
  fs.writeFileSync(path.join(root, 'acceptance.test.cjs'), `const{test}=require('node:test');const a=require('node:assert/strict');const{slug}=require('./slug.cjs');const{order}=require('./order.cjs');
test('slug basic',()=>a.equal(slug('  Hello, WORLD!  '),'hello-world'));test('slug repeated separators',()=>a.equal(slug('a__b---c'),'a-b-c'));test('slug empty',()=>a.equal(slug('!!!'),''));
test('order stable and immutable',()=>{const values=Object.freeze([Object.freeze({id:'a',rank:2}),Object.freeze({id:'b',rank:1}),Object.freeze({id:'c',rank:2})]);const result=order(values);a.deepEqual(result.map(x=>x.id),['b','a','c']);a.notEqual(result,values);a.deepEqual(values.map(x=>x.id),['a','b','c']);});test('order empty',()=>a.deepEqual(order([]),[]));
`)
  if (workload === 'substantial') fs.appendFileSync(path.join(root, 'acceptance.test.cjs'), `
test('ASCII only',()=>a.equal(slug('A K B Ä C'),'a-b-c'));
test('slug components',()=>{const fn=require('./slug.cjs').slugParts;a.deepEqual(fn(' Hello__WORLD! '),['hello','world']);a.deepEqual(fn('!!!'),[]);a.notEqual(fn('a'),fn('a'))});
test('collision avoidance',()=>{const texts=Object.freeze(['A','A','a-2','A','!!!','','item']);const result=require('./slug.cjs').uniqueSlugs(texts);a.deepEqual(result,['a','a-2','a-2-2','a-3','item','item-2','item-3']);a.equal(new Set(result).size,result.length);a.deepEqual(texts,['A','A','a-2','A','!!!','','item'])});
test('rank validation and stability',()=>{const input=Object.freeze([Object.freeze({id:'nan',rank:NaN}),Object.freeze({id:'two',rank:2}),Object.freeze({id:'str',rank:'1'}),Object.freeze({id:'one',rank:1}),Object.freeze({id:'tie',rank:2}),Object.freeze({id:'nil',rank:null}),Object.freeze({id:'inf',rank:Infinity}),Object.freeze({id:'missing'}),Object.freeze({id:'negative',rank:-1})]);const result=require('./order.cjs').rankRows(input);a.deepEqual(result.map(x=>x.id),['negative','one','two','tie','nan','str','nil','inf','missing']);a.notEqual(result,input);a.equal(result[0],input[8]);a.equal(input[0].id,'nan')});
test('group special keys',()=>{const input=Object.freeze([Object.freeze({id:'a',group:'__proto__',rank:2}),Object.freeze({id:'b',group:'constructor',rank:3}),Object.freeze({id:'c',group:'__proto__',rank:1}),Object.freeze({id:'d',group:'constructor',rank:null})]);const fn=require('./order.cjs').groupRows,result=fn(input);a.deepEqual(result.map(x=>[x.key,x.items.map(v=>v.id)]),[['__proto__',['c','a']],['constructor',['b','d']]]);a.equal(result[0].items[0],input[2]);a.deepEqual(fn([]),[]);a.notEqual(result[0].items,fn(input)[0].items)});
test('larger deterministic input',()=>{const input=Object.freeze(Array.from({length:200},(_,i)=>Object.freeze({id:i,group:'g'+i%7,rank:i%13})));const ranked=require('./order.cjs').rankRows(input);a.deepEqual(ranked.map(x=>x.id),[...input].sort((x,y)=>x.rank-y.rank).map(x=>x.id));const names=require('./slug.cjs').uniqueSlugs(Object.freeze(Array(200).fill('same')));a.equal(names[0],'same');a.equal(names[199],'same-200');a.equal(new Set(names).size,200)});
`)
  const fixture = workload === 'extended' ? createExtendedFixture(root) : workload === 'long' ? createLongFixture(root) : { files: ['slug.cjs', 'order.cjs'], groups: [['slug.cjs'], ['order.cjs']], references: ['acceptance.test.cjs'], frozen: ['acceptance.test.cjs', 'package.json', 'package-lock.json', '.gitignore'], goal }
  if (['long', 'extended'].includes(workload)) { fs.unlinkSync(path.join(root, 'slug.cjs')); fs.unlinkSync(path.join(root, 'order.cjs')) }
  const localChecks = process.env.CHORUS_TEAM_PILOT_LOCAL_CHECKS === '1'
  if (localChecks) installTeamLocalChecks(root, fixture, workload, bounded)
  git('add', '.'); git('-c', 'user.name=Chorus Pilot', '-c', 'user.email=pilot@localhost', 'commit', '-qm', 'Frozen independent acceptance')
  const frozen = fixture.frozen.map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')] as const)
  write('fixture.json', { workload, files: fixture.files, groups: fixture.groups, frozen, goal: fixture.goal, submissionLimitSeconds, boundedAssignments: bounded, assignmentGroups: bounded ? boundedTeamGroups(fixture.groups) : fixture.groups })
  const storage = new StorageService(path.join(evidence, 'fixture.db')), sessions = new SessionManager()
  sessions.bindStorage(storage); sessions.bindInstructionsDir(path.join(evidence, 'instructions')); sessions.onExit((id, code) => storage.updateSessionStatus(id, 'exited', code))
  const runtime = new TeamRuntime({ storage, sessions, vault: new CredentialVault(storage), worktrees: new GitWorktreeManager(storage), configDirectory: path.join(evidence, 'config'), bridgeScript: path.resolve('resources/teamBridge.cjs'), memory: async () => ({ servers: [] }) })
  const diagnosticFaults: Array<{ kind: string; attemptId: string }> = []
  if (recoveryControl) {
    assert(!solo && workload === 'small', 'Recovery controls use the small two-helper condition only')
    const spawnHelper = sessions.spawnHelper.bind(sessions)
    sessions.spawnHelper = (attemptId, options) => {
      const attempt = runtime.teams.listRunIds().flatMap(id => runtime.teams.attempts(id)).find(a => a.id === attemptId)!
      const task = runtime.teams.tasks(attempt.runId).find(t => t.id === attempt.taskId)!
      if (attempt.number === 1 && task.command.paths.includes('slug.cjs')) {
        const parser = options.parser
        const inject = (events: ReturnType<typeof parser.push>) => events.map(event => {
          if (event.type !== 'result') return event
          diagnosticFaults.push({ kind: 'controlled-missing-input-result', attemptId })
          return { ...event, isError: true, summary: 'Controlled diagnostic: attempted to read acceptance.typo.test.cjs, which is unavailable. Correct the request to repository-relative acceptance.test.cjs and retry the same owned deliverable; no extra permissions are required.' }
        })
        options = { ...options, parser: { push: chunk => inject(parser.push(chunk)), finish: () => inject(parser.finish()) } }
      }
      return spawnHelper(attemptId, options)
    }
    const capture = runtime.workspace.validateResult.bind(runtime.workspace)
    runtime.workspace.validateResult = async (run, task, attempt) => {
      if (attempt.number === 1 && task.command.paths.includes('order.cjs') && !diagnosticFaults.some(f => f.attemptId === attempt.id)) {
        const wt = storage.getWorktreeById(attempt.worktreeId!)!
        fs.appendFileSync(path.join(wt.path, 'order.cjs'), '\n// Controlled captured defect: fails the committed nonempty ordering contract.\nexports.order = items => [];\n')
        diagnosticFaults.push({ kind: 'controlled-artifact-content-defect', attemptId: attempt.id })
      }
      return capture(run, task, attempt)
    }
  }
  const screen = new Terminal({ cols: 120, rows: 40, scrollback: 2000, allowProposedApi: true })
  let terminal = '', runId = '', sessionId = '', resizedSession = '', promptSent = false, trustSent = false, trustInputAt = 0, submitted = 0, finished = 0, nativeLeadVersion: string | null = null, snapshot: TeamSnapshot | undefined
  let pendingPasteSubmitted = false
  const interventions: unknown[] = [], helpers = Number(process.env.CHORUS_TEAM_PILOT_HELPERS ?? 2)
  const soloCompleted = () => {
    const row = storage.getSessionById(sessionId), assigned = row?.agentSessionId
    if (!row || !assigned) return false
    if (codexLead) return summarizeCodexPilotTranscript(findCodexPilotTranscript(assigned, row.cwd, sessionId, Date.parse(row.createdAt)), assigned, row.cwd, sessionId).completed
    const file = path.join(os.homedir(), '.claude', 'projects', path.resolve(row.cwd).replace(/[^a-zA-Z0-9]/g, '-'), `${assigned}.jsonl`)
    if (!fs.existsSync(file)) return false
    return fs.readFileSync(file, 'utf8').split('\n').some(line => { try { const e = JSON.parse(line); return e.sessionId === assigned && e.type === 'assistant' && e.message?.content?.some((c: any) => c.type === 'text' && c.text.includes('PILOT_COMPLETE')) } catch { return false } })
  }
  let report: Record<string, unknown> | undefined
  try {
    const { project } = storage.getOrCreateProject(root)
    if (!solo) copyFixtureCredential(process.env.CHORUS_TEAM_PILOT_SOURCE_DB!, storage)
    await runtime.start()
    const capabilities = await runtime.capabilities(); write('capabilities.json', capabilities)
    const lead = capabilities.options.find(o => o.key === leadKey)!; assert(lead?.enabled, `Lead ${leadKey} is not available`)
    nativeLeadVersion = lead.member.installedVersion
    if (solo) {
      sessionId = randomUUID(); storage.createSession({ id: sessionId, projectId: project.id, agent: lead.member.harness, cwd: root, status: 'running', createdAt: new Date().toISOString() })
    } else {
      const helper = capabilities.options.find(o => o.member.model === defaultTeamHelperModel && o.enabled); assert(helper, 'No saved OpenRouter credential is available')
      const ack = await runtime.service.createRun({ projectId: project.id, clientRequestId: 'live-pilot', config: { schemaVersion: 1, baseRevision: 'HEAD', lead: { ...lead.member, id: randomUUID() }, helpers: Array.from({ length: helpers }, (_, i) => ({ ...helper.member, ...(process.env.CHORUS_TEAM_PILOT_HELPER_EFFORT ? { effort: process.env.CHORUS_TEAM_PILOT_HELPER_EFFORT } : {}), id: randomUUID(), label: `DeepSeek helper ${i + 1}` })), concurrency: helpers, executionMinutes: ['long', 'extended'].includes(workload) ? 15 : 10, integrationPolicy: 'lead-integrates', publicationPolicy: 'auto-clean', verificationProfile: 'npm-project', leadContext } }, { role: 'user', principal: 'live-pilot' }); runId = String(ack.runId)
    }
    sessions.onData((id, text) => { if (id === sessionId || runId && runtime.teams.getRun(runId).leadSessionId === id) { terminal += text; screen.write(text); write('terminal.log', terminal) } })
    const soloMcp = path.join(evidence, 'solo-mcp.json')
    if (solo && leadContext === 'focused') fs.writeFileSync(soloMcp, JSON.stringify({ mcpServers: {} }))
    if (solo) sessions.launch(lead.member.harness, root, sessionId, { permissionMode: codexLead ? 'full-access' : 'manual', forceFreshConversation: true, requireInstructions: !codexLead, disableResumeFallback: true, instructions: 'Disposable bounded implementation fixture. Read and edit only assigned files. Native subagents are disabled. The native file edits, npm test, npm run typecheck, npm run build and committing only the assigned implementation files are authorized. Keep acceptance files unchanged.', teamLaunchArgs: codexLead ? ['--no-daemon', '-m', lead.member.model, '-c', 'model_reasoning_effort="medium"', '-c', 'features.multi_agent=false', '-c', 'windows.sandbox="elevated"', '-c', 'check_for_update_on_startup=false'] : ['--model', lead.member.model, '--effort', lead.member.effort ?? 'medium', ...(leadContext === 'focused' ? ['--mcp-config', soloMcp, '--strict-mcp-config', '--disable-slash-commands'] : []), '--disallowedTools', 'Agent,Task', '--allowedTools', 'Edit', 'Write', ...['Bash', 'PowerShell'].flatMap(tool => ['npm test', 'npm run typecheck', 'npm run build', `git add ${fixture.files.join(' ')}`, 'git commit:*'].map(command => `${tool}(${command})`))], envAdditions: { DISABLE_AUTOUPDATER: '1', PATHEXT: '.COM;.EXE;.BAT;.CMD' } })
    let deadline = Date.now() + 120000
    while (Date.now() < deadline) {
      if (runId) { const current: TeamSnapshot = runtime.teams.snapshot(runId); snapshot = current; sessionId = current.run.leadSessionId ?? ''; write('snapshot.json', current) }
      if (sessionId && resizedSession !== sessionId) { sessions.resize(sessionId, 120, 40); resizedSession = sessionId }
      const view = Array.from({ length: screen.rows }, (_, i) => screen.buffer.active.getLine(screen.buffer.active.baseY + i)?.translateToString(true) ?? '').join('\n'); write('screen.txt', view)
      const control = path.join(evidence, 'input.json')
      if (sessionId && fs.existsSync(control)) { const input = JSON.parse(fs.readFileSync(control, 'utf8')); fs.unlinkSync(control); if (typeof input.text === 'string') { interventions.push({ action: 'Explicit fixture input', at: new Date().toISOString() }); sessions.write(sessionId, input.text) } }
      if (!trustSent && sessionId && /Yes, I trust this folder|Yes, continue|Trust this (?:folder|directory)|trust the contents of this directory|Trust and continue/i.test(view)) {
        // Resize can reset the CLI selection. Observe the selected row before
        // confirming; never blindly toggle and immediately press Enter.
        if (/[❯›>]\s+(?:1\.\s+)?(?:Yes, (?:I trust this folder|continue)|Trust and continue)/.test(view) && Date.now() - trustInputAt > 750) {
          trustSent = true; interventions.push({ action: 'Initial disposable workspace trust', at: new Date().toISOString() }); sessions.write(sessionId, '\r')
        } else if (/[❯›>]\s+(?:2\.\s+)?(?:No, exit|Quit)/.test(view) && Date.now() - trustInputAt > 1500) { sessions.write(sessionId, '\x1b[A'); trustInputAt = Date.now() }
      }
      const startupBlocked = /trust this folder|Quicksafetycheck|trust the contents|Trust and continue|Update available/i.test(view)
      // ConPTY may deliver Enter while Codex is still classifying a large paste.
      // Only retry the keystroke while the exact unsent paste is visibly present;
      // never send another prompt or steer an active/completed model turn.
      if (codexLead && promptSent && !pendingPasteSubmitted && Date.now() - submitted > 5000 && /^\s*[›>]\s*\[Pasted Content \d+ chars\]\s*$/m.test(view)) {
        pendingPasteSubmitted = true
        interventions.push({ action: 'Automatic submission of visibly pending paste', at: new Date().toISOString() })
        sessions.write(sessionId, '\r')
      }
      if (!promptSent && sessionId && !startupBlocked && (solo ? (codexLead ? view.toLowerCase().includes(lead.member.model) && /medium/.test(view) : /Opus.*medium effort/.test(view) && /\? for shortcuts/.test(view)) : snapshot?.run.status === 'active' && (!codexLead || view.toLowerCase().includes(lead.member.model)))) {
        promptSent = true; submitted = Date.now(); deadline = submitted + submissionLimitSeconds * 1000
        const assignments = bounded ? boundedTeamGroups(fixture.groups) : fixture.groups
        const delegation = bounded ? `three sequential rounds of two independent code tasks, reusing the two helper slots: ${[0, 2, 4].map((start, i) => `round ${i + 1}: ${assignments.slice(start, start + 2).map(group => group.join(', ')).join(' versus ')}`).join('; ')}. Create only the current round with team_delegate_many. Capture and inspect both results, then apply both to integration before delegating the next round so its workspaces inherit the earlier implementations. Earlier-round files are read-only dependencies. These are six separate tasks with exact three- or four-file ownership; do not combine them into ten-file assignments. Keep earlier integrated results awaiting final review until the complete suite can pass` : helpers === 2 ? `two independent code tasks, one per helper, with ownership ${fixture.groups.map(group => group.join(', ')).join(' versus ')}` : 'one complete code task implementing all assigned modules'
        const workflow = solo ? `Use the native ${codexLead ? 'apply_patch' : 'Edit or Write'} tools for ${fixture.files.join(', ')}. Run each command separately: npm test; npm run typecheck; npm run build; git add ${fixture.files.join(' ')}; git commit -m "Implement fixture". Keep acceptance files unchanged, then finish with PILOT_COMPLETE.` : `Use chorus-team to delegate ${delegation}. Give complete explicit briefs and acceptance criteria; references contains ${fixture.references.join(' and ')}. Read the committed specification to assign its sections; keep each brief/context under 2000 characters combined, referencing contracts instead of reproducing them. For the lead only, read-only native file inspection is authorized. If a Node reader is unavailable, use native exec_command with standalone PowerShell Get-Content or rg to read the committed repository files. Chorus supplies helper sandbox/check/capture rules. Use team_delegate_many for each independent pair of assignments. In each helper brief, require native read/glob/grep for file inspection, never shell readers or node -e. Keep the two subsystems independent: do not import undocumented private utilities from the other helper's files. ${localChecks ? 'Require helpers to run npm test for their exact owned assignment behavioral acceptance, then npm run typecheck and npm run build. Do not run node --test in helpers because it bypasses the committed ownership selector.' : 'Explicitly permit npm run typecheck and npm run build only for local checks. Tell helpers to defer npm test and node --test until integration: the other subsystem is deliberately stubbed, and its expected failures create irrelevant large logs.'} Do not ask helpers to inspect external CLI tool-output files or use shell log filters. Chorus runs the full frozen acceptance suite at the combined integration HEAD. Inspect immutable artifacts through team_detail diff, inspect and integrate each result in sequence. After all ${bounded ? 'six' : helpers === 2 ? 'two' : 'one'} results are applied, use team_verify command suite at the combined integration HEAD, wait with target checks and its verificationIds, and submit team_review_many referencing those IDs. Do not copy logs or proof fields. Use team_wait target results with outstanding taskIds, afterSequence from the last response and timeoutMs 900000 while waiting for results; do not poll routine progress. Then team_finish at the verified HEAD; Chorus performs remaining final checks, publication and cleanup. Do not directly run Git, verification commands or change files as lead. No clarification should be needed.`
        sessions.write(sessionId, `${fixture.goal}\n${workflow}${recoveryControl ? '\nThis explicitly controlled diagnostic injects one missing-input result and one content defect into first attempts. Use the normal counted revision workflow to correct both; keep independent work and finish without further user input.' : ''}`); await sleep(codexLead ? 2000 : 350); sessions.write(sessionId, '\r')
      }
      if (snapshot?.run.status === 'blocked') throw Error(snapshot.run.blocker ?? 'Team blocked')
      if (snapshot?.run.finish?.status === 'blocked') throw Error(snapshot.run.finish.blocker ?? 'Finish blocked')
      if (solo ? promptSent && soloCompleted() && git('status', '--porcelain') === '' : snapshot?.run.status === 'completed' && snapshot.run.finish?.status === 'cleaned') {
        finished = Date.now(); break
      }
      if (!solo && codexLead && submitted && snapshot?.run.status === 'active' && !snapshot.attempts.some(a => ['preparing', 'running', 'cancelling'].includes(a.status))) {
        const row = storage.getSessionById(sessionId), assigned = row?.agentSessionId
        if (row && assigned && summarizeCodexPilotTranscript(findCodexPilotTranscript(assigned, row.cwd, sessionId, Date.parse(row.createdAt)), assigned, row.cwd, sessionId).lastTurnCompleted) {
          throw new Error('Codex lead ended its turn before Team completion with no active helper. See the preserved screen and native transcript; further input would be required.')
        }
      }
      await sleep(1000)
    }
    if (recoveryControl) { assert.equal(diagnosticFaults.length, 2); assert.equal(snapshot?.tasks.length, 2); assert(snapshot?.attempts.some(a => a.revisionSeed), 'Content revision must use a captured seed') }
    assert(finished, 'Live pilot timed out; retained terminal and snapshot describe the failure')
    for (const [file, expected] of frozen) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'), expected, `Frozen ${file} changed`)
    const node = execFileSync('where.exe', ['node.exe'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)[0]
    execFileSync(node, ['--test'], { cwd: root, windowsHide: true, timeout: 30000 })
    assert.equal(git('status', '--porcelain'), '')
    if (!solo) assert.deepEqual(storage.getWorktreesForProject(project.id).map(w => w.id).sort(), [...snapshot!.run.finish!.retainedWorktreeIds].sort(), 'Every retained worktree must have an explicit cleanup disposition')
    const row = storage.getSessionById(sessionId), assigned = row?.agentSessionId
    const cwd = row?.cwd ?? root, transcript = assigned ? path.join(os.homedir(), '.claude', 'projects', path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-'), `${assigned}.jsonl`) : ''
    const messages = new Map<string, any>(), models = new Set<string>()
    if (transcript && fs.existsSync(transcript)) for (const line of fs.readFileSync(transcript, 'utf8').split('\n')) {
      try { const item = JSON.parse(line); if (item.sessionId === assigned && item.type === 'assistant' && item.message?.id && item.message?.usage) { messages.set(item.message.id, item.message.usage); if (item.message.model) models.add(item.message.model) } } catch { /* Non-record line. */ }
    }
    const values = [...messages.values()]
    const usage = values.length ? { inputTokens: values.reduce((n, u) => n + (u.input_tokens ?? 0), 0), outputTokens: values.reduce((n, u) => n + (u.output_tokens ?? 0), 0), cacheReadTokens: values.reduce((n, u) => n + (u.cache_read_input_tokens ?? 0), 0), cacheCreationTokens: values.reduce((n, u) => n + (u.cache_creation_input_tokens ?? 0), 0), messages: values.length } : null
    const overlap = summarizeTeamAttemptTimings(snapshot?.attempts ?? [], TEAM_LIMITS.preparationMs).overlap
    if (!solo && helpers === 2) assert(overlap, 'Two-helper execution did not overlap')
    report = { passed: true, condition: solo ? 'lead-only' : `team-${helpers}`, lead: lead.member.model, actualLeadModels: [...models], helperModel: solo ? null : defaultTeamHelperModel, elapsedSeconds: (finished - submitted) / 1000, launchSeconds: submitted ? (submitted - Date.parse(snapshot?.run.createdAt ?? new Date(submitted).toISOString())) / 1000 : null, overlap, acceptanceFrozen: true, destinationPublished: !solo, cleanupConfirmed: !solo, allWorktreesRemoved: solo ? null : snapshot!.run.finish!.retainedWorktreeIds.length === 0, cleanup: snapshot?.run.finish, leadUsage: usage, helperUsage: snapshot?.attempts.map(a => ({ status: a.status, usage: a.usage })), interventions, subscriptionBilledUsd: null, evidence }
  } catch (error) { report = { passed: false, condition: solo ? 'lead-only' : `team-${helpers}`, message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : null, elapsedSeconds: submitted ? (Date.now() - submitted) / 1000 : null, evidence, interventions }; write('failure.json', report); process.exitCode = 1 }
  finally {
    // Include failed trials in accounting; exact assigned transcripts only, never
    // a heuristic scan that could claim another session's usage.
    if (report) {
      report.executionIdentity = executionIdentity
      report.helperLaunches = helperLaunches
      report.unattended = !interventions.some(entry => (entry as { action?: string }).action === 'Explicit fixture input')
      report.recoveryControl = recoveryControl; report.diagnosticFaults = diagnosticFaults; report.localChecks = localChecks; report.helperEffortOverride = process.env.CHORUS_TEAM_PILOT_HELPER_EFFORT || null; report.helperEffort = snapshot?.run.config.helpers[0]?.effort ?? null; report.workload = workload; report.fixtureVersion = bounded ? 3 : workload === 'extended' ? 2 : 1; report.boundedAssignments = bounded; report.submissionLimitSeconds = submissionLimitSeconds
      report.leadContext = leadContext
      const row = sessionId ? storage.getSessionById(sessionId) : null, assigned = row?.agentSessionId
      report.nativeConversationId = assigned ?? null; report.nativeLeadSessionId = sessionId || null; report.electronVersion = process.versions.electron
      report.helperCliVersions = runId ? runtime.teams.getRun(runId).config.helpers.map(m => ({ harness: m.harness, version: m.installedVersion })) : []
      const transcript = assigned && row ? path.join(os.homedir(), '.claude', 'projects', path.resolve(row.cwd).replace(/[^a-zA-Z0-9]/g, '-'), `${assigned}.jsonl`) : ''
      const audit = codexLead && row && assigned ? summarizeCodexPilotTranscript(findCodexPilotTranscript(assigned, row.cwd, sessionId, Date.parse(row.createdAt)), assigned, row.cwd, sessionId) : summarizeTeamLeadTranscript(transcript && fs.existsSync(transcript) ? fs.readFileSync(transcript, 'utf8') : '', assigned ?? '')
      report.leadUsage = audit.usage; report.leadToolCalls = audit.toolCalls; report.leadModelRequests = audit.modelRequests
      report.actualLeadModels = audit.models; report.subscriptionBilledUsd = null; report.activityBreakdown = audit.buckets
      report.leadHarness = codexLead ? 'codex' : 'claude'; report.startedAt = submitted ? new Date(submitted).toISOString() : null; report.endedAt = finished ? new Date(finished).toISOString() : new Date().toISOString()
      report.requestedLeadKey = leadKey; report.requestedEffort = 'medium'; report.cliVersions = { [codexLead ? 'codex' : 'claude']: nativeLeadVersion }
      if ('identityVerified' in audit) { report.nativeUsageCoverage = audit.coverage; report.actualLeadEfforts = audit.efforts; report.leadApiEquivalentUsd = audit.apiEquivalentUsd; report.comparisonValid = audit.identityVerified && audit.coverage === 'verified-thread' && audit.models.length === 1 && audit.models[0] === (leadKey === 'codex-sol' ? 'gpt-6.1-sol' : 'gpt-6-astra') && audit.efforts.length === 1 && audit.efforts[0] === 'medium' }
      if (report.unattended === false) report.comparisonValid = false
      const u = audit.usage
      if (u && audit.models.length === 1 && audit.models[0] === 'claude-opus-5-5') {
        const fixed = (u.inputTokens * 4 + u.outputTokens * 20 + u.cacheReadTokens * .2) / 1000000
        const cu = u as NonNullable<ReturnType<typeof summarizeTeamLeadTranscript>['usage']>
        const knownCache = (cu.cacheCreation5mTokens * 5 + cu.cacheCreation1hTokens * 8) / 1000000
        const unknownTtlTokens = Math.max(0, cu.cacheCreationTokens - cu.cacheCreation5mTokens - cu.cacheCreation1hTokens)
        report.leadApiEquivalentUsd = { low: fixed + knownCache + unknownTtlTokens * 5 / 1000000, high: fixed + knownCache + unknownTtlTokens * 8 / 1000000, unknownCacheTtlTokens: unknownTtlTokens,
          model: 'claude-opus-5-5', ratesPerMillion: { input: 4, output: 20, cacheRead: .2, cacheWrite5m: 5, cacheWrite1h: 8 }, source: 'https://platform.claude.com/docs/en/models/opus-5-5/whats-new-opus-5-5', accessed: '2026-09-30', attribution: 'Standard global API-equivalent token estimate, not subscription billing; excludes tool charges, taxes and provider fees.' }
      }
      write('lead-activity.json', audit)
      if (runId) {
        const current: TeamSnapshot = runtime.teams.snapshot(runId); snapshot = current
        const records = current.attempts.flatMap(a => a.usage), priced = records.filter(u => u.costUsd !== null)
        report.helperUsage = current.attempts.map(a => ({ status: a.status, usage: a.usage, startedAt: a.startedAt, endedAt: a.endedAt }))
        report.helperReportedUsd = { knownUsd: priced.reduce((sum, u) => sum + u.costUsd!, 0), records: records.length, missingRecords: records.length - priced.length, attribution: 'CLI task records; may omit automatic title-model requests; not reconciled provider billing' }
        const denied = new Set(current.attempts.filter(a => a.status === 'permission-blocked').map(a => a.id))
        let after = 0
        for (;;) {
          const page = runtime.teams.events(runId, after); if (!page.length) break
          for (const event of page) if (event.operation === 'helper-blocker' && event.payload.category === 'permission-blocked' && typeof event.payload.attemptId === 'string') denied.add(event.payload.attemptId)
          after = page.at(-1)!.sequence
        }
        report.retries = current.attempts.length - current.tasks.length; report.permissionFailures = denied.size
        report.helperFailures = current.attempts.filter(a => a.status !== 'succeeded').map(a => ({ attemptId: a.id, status: a.status, nativePermissionDenied: denied.has(a.id), failure: a.result?.failure ?? null, blocker: a.blocker }))
        report.cleanup = current.run.finish
        const timings = summarizeTeamAttemptTimings(current.attempts, TEAM_LIMITS.preparationMs)
        report.helperTimings = timings.intervals.map(({ taskId, memberId, preparationSeconds, executionSeconds }) => ({ taskId, memberId, preparationSeconds, executionSeconds }))
        report.helperOverlapSeconds = timings.overlapSeconds
        const leadEstimate = report.leadApiEquivalentUsd as {low: number; high: number} | undefined
        if (leadEstimate && records.length && priced.length === records.length) report.totalApiEquivalentPlusHelperReportedUsd = { low: leadEstimate.low + priced.reduce((n, u) => n + u.costUsd!, 0), high: leadEstimate.high + priced.reduce((n, u) => n + u.costUsd!, 0), attribution: 'Lead API-equivalent estimate plus CLI-reported helper cost; not a reconciled total bill.' }

        write('snapshot.json', snapshot)
      }
      write('report.json', report)
    }
    try { await runtime.shutdown(); if (solo && sessionId) sessions.kill(sessionId); if (report) write('report.json', report) } catch (error) { write('failure.json', { message: error instanceof Error ? error.message : String(error), stage: 'shutdown', evidence }); process.exitCode = 1 }
    await sessions.disposeHelpers(); storage.close(); app.exit(Number(process.exitCode ?? 0))
  }
}).catch(error => { write('failure.json', { message: String(error), evidence }); app.exit(1) })
