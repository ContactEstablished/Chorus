// Disposable compatibility evidence only. This is not the production scheduler or broker.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import readline from 'node:readline'
const require = createRequire(import.meta.url)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function runLive({ root, evidence, bridge, names, schemas, option }) {
  if (path.relative(root, evidence).split(path.sep)[0] !== '..' && !path.isAbsolute(path.relative(root, evidence))) throw Error('Live evidence must be outside the project.')
  if (fs.readdirSync(evidence).length !== 0) throw Error('Live evidence must be a new empty disposable directory.')
  const esbuild = require('esbuild')
  const bundle = path.join(root, '_verify', `team-adapters-${crypto.randomUUID()}.cjs`)
  await esbuild.build({ stdin: { contents: `export { helperRegistry } from './src/main/adapters/helpers/registry'; export { composeHelperEnv } from './src/main/adapters/helpers/common'; export { buildTeamLeadConfiguration } from './src/main/adapters/teamLead'; export { resolveCli } from './src/main/services/cliDetect';`, resolveDir: root, loader: 'ts' }, outfile: bundle, bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
  const { helperRegistry, composeHelperEnv, buildTeamLeadConfiguration, resolveCli } = require(bundle)
  const token = crypto.randomBytes(32).toString('base64url')
  const apiKey = process.env.CHORUS_COMPAT_OPENROUTER_KEY
  const interactive = process.argv.includes('--interactive')
  const scrub = text => [token, apiKey].filter(Boolean).reduce((s, key) => s.split(key).join('[REDACTED]'), String(text))
  const write = (file, data) => fs.writeFileSync(path.join(evidence, file), scrub(typeof data === 'string' ? data : JSON.stringify(data, null, 2)))
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { windowsHide: true, encoding: 'utf8' }).trim()
  const source = path.join(evidence, 'source')
  fs.mkdirSync(source)
  git(source, 'init', '-q')
  fs.writeFileSync(path.join(source, 'sum.cjs'), 'exports.sum=(a,b)=>a-b;\n')
  fs.writeFileSync(path.join(source, 'sum.test.cjs'), "const{test}=require('node:test');const assert=require('node:assert/strict');const{sum}=require('./sum.cjs');test('adds',()=>assert.equal(sum(2,3),5));\n")
  git(source, 'add', '.')
  git(source, '-c', 'user.name=Chorus Compatibility', '-c', 'user.email=compatibility@localhost', 'commit', '-qm', 'Disposable fixture')
  const baseline = git(source, 'rev-parse', 'HEAD')
  const versions = {}
  for (const id of ['claude', 'codex', 'opencode']) versions[id] = await helperRegistry[id].probe(new AbortController().signal)
  write('versions.json', versions)
  const tasks = new Map()
  const journal = []
  const owned = new Set()
  let active = 0, peak = 0, sequence = 0
  const record = (type, detail) => { journal.push({ at: new Date().toISOString(), type, ...detail }); write('journal.json', journal) }
  const snapshot = () => [...tasks.values()].map(t => ({ taskId: t.id, memberId: t.member, kind: t.kind, state: t.state, attempt: t.attempt, summary: t.summary, tested: t.tested, error: t.error }))
  const identity = pid => {
    let value
    try { value = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$p=Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue; if(-not $p) { exit 3 }; try { $p.StartTime.ToFileTimeUtc().ToString() } catch { exit 4 }`], { windowsHide: true, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
    catch (error) { if (error.status === 3) return null; throw Error('Owned process liveness is unknown.') }
    if (!/^\d+$/.test(value)) throw Error('Could not verify owned process identity.')
    return value
  }
  const descendants = pid => JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$all=@(Get-CimInstance Win32_Process); $ids=[System.Collections.Generic.HashSet[int]]::new(); [void]$ids.Add(${Number(pid)}); do { $changed=$false; foreach($p in $all) { if($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)) { $changed=$true } } } while($changed); $result=@(foreach($id in $ids) { $p=Get-Process -Id $id -ErrorAction SilentlyContinue; if($p) { @{ pid=$id; start=$p.StartTime.ToFileTimeUtc().ToString() } } }); ConvertTo-Json -Compress -InputObject $result`], { windowsHide: true, encoding: 'utf8', timeout: 15000 }))
  const terminate = child => {
    if (child.exitCode !== null || !child.pid || !child.chorusStart) return
    // Recheck creation time in the same shell immediately before terminating this owned tree.
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$p=Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue; if($p -and $p.StartTime.ToFileTimeUtc().ToString() -eq '${child.chorusStart}') { & taskkill.exe /PID ${child.pid} /T /F | Out-Null }`], { windowsHide: true, timeout: 15000 })
  }
  const startAttempt = task => {
    if (active >= 2) throw Error('Fixture concurrency limit reached.')
    const cwd = path.join(evidence, `${task.id}-attempt-${task.attempt}`)
    git(source, 'worktree', 'add', '--detach', cwd, baseline)
    if (task.cancelFixture) {
      fs.writeFileSync(path.join(cwd, 'sum.test.cjs'), "const{test}=require('node:test');const{spawn}=require('node:child_process');test('owned descendant',async()=>{const p=spawn(process.execPath,['-e',\"setInterval(()=>require('fs').writeFileSync('tick.txt',String(Date.now())),100)\"],{stdio:'ignore'});await new Promise(r=>setTimeout(r,90000));p.kill();});\n")
      git(cwd, 'add', 'sum.test.cjs'); git(cwd, '-c', 'user.name=Chorus Compatibility', '-c', 'user.email=compatibility@localhost', 'commit', '-qm', 'Owned cancellation fixture')
    }
    const adapter = helperRegistry[task.member]
    const input = { attemptId: `${task.id}-${task.attempt}`, cwd, kind: task.kind, brief: task.brief,
      model: task.member === 'claude' ? 'sonnet' : task.member === 'codex' ? 'gpt-6-astra' : 'z-ai/glm-5.3',
      effort: task.member === 'codex' ? 'low' : undefined, windowsSandbox: 'elevated', allowedCommands: ['node --test'], signal: new AbortController().signal }
    if (task.member === 'opencode') {
      if (!apiKey) throw Error('OpenRouter live route requires CHORUS_COMPAT_OPENROUTER_KEY in the verifier environment.')
      input.credential = { value: apiKey, envVarName: 'OPENROUTER_API_KEY' }
      input.route = { baseUrl: 'https://openrouter.ai/api/v1', providerName: 'OpenRouter' }
    }
    const request = adapter.buildExecution(input)
    const parser = adapter.createParser()
    const child = spawn(request.executable, request.args, { cwd, env: composeHelperEnv(process.env, request), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    owned.add(child); child.chorusStart = identity(child.pid)
    if (!child.chorusStart) throw Error('Helper exited before its process identity was captured.')
    task.child = child; task.cwd = cwd; task.state = 'running'; task.started = Date.now(); active++; peak = Math.max(peak, active)
    record('helper-started', { taskId: task.id, attempt: task.attempt, member: task.member, active })
    let stdout = '', stderr = '', events = []
    child.stdout.on('data', data => { stdout += data; events.push(...parser.push(data)); if (Buffer.byteLength(stdout) > 10 * 1024 * 1024) terminate(child) })
    child.stderr.on('data', data => { stderr += data; if (Buffer.byteLength(stderr) > 1024 * 1024) terminate(child) })
    child.on('error', () => { task.error = 'Helper spawn failed.' })
    const timer = setTimeout(() => { task.state = 'timed-out'; terminate(child) }, 180000)
    task.done = new Promise(resolve => child.on('close', code => {
      clearTimeout(timer); active--; owned.delete(child); events.push(...parser.finish())
      const result = events.findLast(e => e.type === 'result')
      task.summary = result?.summary ?? ''; task.code = code; task.events = events; task.raw = stdout
      if (task.state === 'running') task.state = code === 0 && result && !result.isError && !events.some(e => e.type === 'protocol-error') ? 'reviewable' : 'failed'
      task.tested = false
      if (task.kind === 'code' && task.state === 'reviewable') {
        try { task.testOutput = execFileSync(process.execPath, ['--test'], { cwd, windowsHide: true, encoding: 'utf8', timeout: 10000 }); task.tested = true } catch { task.error = 'Independent fixture test failed.' }
      }
      task.diff = git(cwd, 'diff', '--name-only')
      if (task.kind === 'analysis' && git(cwd, 'status', '--porcelain')) { task.state = 'failed'; task.error = 'Analysis helper modified its worktree.' }
      write(`${task.id}-${task.attempt}.jsonl`, stdout); write(`${task.id}-${task.attempt}.stderr.log`, stderr); write(`${task.id}-${task.attempt}.events.json`, events)
      record('helper-exited', { taskId: task.id, attempt: task.attempt, code, state: task.state, tested: task.tested, diff: task.diff, elapsedMs: Date.now() - task.started })
      resolve()
    }))
    child.stdin.end(request.stdin)
  }
  const handler = async (name, args) => {
    if (name === 'team_roster') return { members: ['claude', 'codex', ...(apiKey ? ['opencode'] : [])], concurrency: 2 }
    if (name === 'team_status') return { tasks: snapshot() }
    if (name === 'team_delegate') {
      if (!['claude', 'codex', ...(apiKey ? ['opencode'] : [])].includes(args.memberId) || !['code', 'analysis'].includes(args.kind) || typeof args.brief !== 'string' || args.brief.length > 64000) throw Error('Invalid fixture delegation.')
      const task = { id: `task-${++sequence}`, member: args.memberId, kind: args.kind, brief: args.brief, attempt: 1 }
      tasks.set(task.id, task); startAttempt(task); return { taskId: task.id, state: task.state }
    }
    if (name === 'team_wait') {
      const until = Date.now() + Math.min(20000, Math.max(1, args.timeoutMs ?? 20000))
      const ids = args.taskIds ?? [...tasks.keys()]
      while (Date.now() < until && ids.some(id => tasks.get(id)?.state === 'running')) await sleep(100)
      return { tasks: snapshot(), timedOut: ids.some(id => tasks.get(id)?.state === 'running') }
    }
    const task = tasks.get(args.taskId)
    if (!task) throw Error('Unknown fixture task.')
    if (name === 'team_cancel') { task.state = 'cancelled'; terminate(task.child); await task.done; return { taskId: task.id, state: task.state } }
    if (name === 'team_review') return { taskId: task.id, state: task.state, summary: task.summary, independentTestsPassed: task.tested, testOutput: task.testOutput, diff: task.diff }
    if (name === 'team_revise') {
      if (!['reviewable', 'failed'].includes(task.state) || task.attempt >= 3 || typeof args.brief !== 'string') throw Error('Revision is unavailable.')
      task.attempt++; task.brief = args.brief; startAttempt(task); return { taskId: task.id, attempt: task.attempt, state: task.state }
    }
    throw Error('Integration is outside the compatibility fixture; no destination effects.')
  }
  const server = http.createServer({ maxHeaderSize: 16384 }, (req, res) => {
    if (req.url !== '/team' || req.method !== 'POST' || req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return }
    let body = ''
    req.on('data', chunk => { body += chunk; if (Buffer.byteLength(body) > 1048576) req.destroy() })
    req.on('end', async () => {
      try {
        const data = JSON.parse(body)
        if (data.method === 'tools/list') { record('tools-listed', {}); res.end(JSON.stringify({ ok: true, result: { tools: schemas } })); return }
        record('tool-called', { name: data.name, arguments: data.arguments })
        const result = await handler(data.name, data.arguments ?? {})
        res.end(JSON.stringify({ ok: true, result }))
      } catch (error) { res.end(JSON.stringify({ ok: false, error: { code: 'FIXTURE_ERROR', message: scrub(error.message) } })) }
    })
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const endpoint = `http://127.0.0.1:${server.address().port}/team`
  try {
    if (process.argv.includes('--helper-matrix')) {
      const matrix = []
      for (const member of ['claude', 'codex', ...(apiKey ? ['opencode'] : [])]) {
        const task = { id: `task-${++sequence}`, member, kind: 'code', attempt: 1, brief: 'Fix sum.cjs so it adds its arguments. Run node --test. Do not change tests, install dependencies, commit, or use subagents. Report the actual test result.' }
        tasks.set(task.id, task); startAttempt(task); await task.done
        if (task.state !== 'reviewable' || !task.tested || task.diff !== 'sum.cjs' || !/TAP|tests?\s+1|pass\s+1/.test(task.raw)) throw Error(`${member} code/test evidence failed.`)
        const cancelled = { id: `task-${++sequence}`, member, kind: 'code', attempt: 1, cancelFixture: true, brief: 'Run node --test and await its completion. This disposable test intentionally runs for 90 seconds and spawns an owned child. Do not edit, install, commit, use subagents, or terminate the test yourself. The compatibility harness will cancel your process tree.' }
        tasks.set(cancelled.id, cancelled); startAttempt(cancelled)
        const tick = path.join(cancelled.cwd, 'tick.txt')
        const until = Date.now() + 60000
        while (!fs.existsSync(tick) && Date.now() < until && cancelled.state === 'running') await sleep(100)
        if (!fs.existsSync(tick)) throw Error(`${member} did not start the cancellation writer fixture.`)
        const observed = descendants(cancelled.child.pid)
        if (observed.length < 3 || observed.some(p => !Number.isSafeInteger(p.pid) || !/^\d+$/.test(p.start))) throw Error(`${member} descendant chain was not fully identified.`)
        cancelled.state = 'cancelled'; terminate(cancelled.child); await cancelled.done
        const stoppedValue = fs.readFileSync(tick, 'utf8'); await sleep(1500)
        const survivors = observed.filter(p => identity(p.pid) === p.start)
        if (survivors.length || fs.readFileSync(tick, 'utf8') !== stoppedValue) throw Error(`${member} cancellation left an observed writer alive.`)
        matrix.push({ member, codeTask: task.id, cancellationTask: cancelled.id, descendantCount: observed.length, stableWriterMs: 1500, passed: true })
        write('helper-matrix-report.json', { passed: false, completed: matrix, versions })
      }
      write('helper-matrix-report.json', { passed: true, completed: matrix, versions })
      console.log(JSON.stringify({ passed: true, mode: 'native-helper-matrix', evidence }))
      return
    }
    if (process.argv.includes('--permissions-only')) {
      for (const member of ['claude', 'codex', ...(apiKey ? ['opencode'] : [])]) {
        const task = { id: `task-${++sequence}`, member, kind: 'analysis', attempt: 1, brief: 'Permission-boundary compatibility test in a disposable fixture: try to edit sum.cjs so subtraction becomes addition. Attempt the edit with an available native tool, then report whether the tool policy or sandbox allowed it. Do not use subagents, network, external paths, configuration changes, or bypass flags.' }
        tasks.set(task.id, task); startAttempt(task); await task.done
        if (task.code !== 0 || !task.events.some(e => e.type === 'result') || (task.events.some(e => e.type === 'result' && e.isError) && !task.events.some(e => e.type === 'permission-blocked')) || task.events.some(e => e.type === 'protocol-error') || git(task.cwd, 'status', '--porcelain') || !fs.readFileSync(path.join(task.cwd, 'sum.cjs'), 'utf8').includes('a-b')) throw Error(`${member} analysis permission boundary was not proved.`)
      }
      write('permission-report.json', { mode: 'native-analysis-edit-denial', passed: true, tasks: snapshot(), versions })
      console.log(JSON.stringify({ passed: true, mode: 'native-analysis-edit-denial', evidence }))
      return
    }
    for (const lead of (option('--lead') ? [option('--lead')] : ['claude', 'codex'])) {
      if (!['claude', 'codex'].includes(lead)) throw Error('Unknown lead.')
      const cwd = path.join(evidence, `lead-${lead}`); git(source, 'worktree', 'add', '--detach', cwd, baseline)
      const descriptor = buildTeamLeadConfiguration({ lead, worktree: cwd, configDirectory: path.join(evidence, `config-${lead}`), nodeExecutable: process.execPath, bridgeScript: bridge, verifiedVersion: versions[lead].version })
      const cli = resolveCli(lead)
      const prompt = `This is a bounded Chorus compatibility fixture. Use only chorus-team MCP tools. First call team_roster. Delegate TWO tasks before waiting: (1) memberId claude kind code, brief: Fix sum.cjs to add arguments and run node --test. Do not change tests, install dependencies, commit or use subagents. (2) memberId ${apiKey ? 'opencode' : 'codex'} kind analysis, brief: Read sum.cjs and sum.test.cjs, explain the subtraction bug, actual numeric result and expected numeric result. Read-only shell commands are allowed; do not edit, install, use network or subagents. Collect both results using team_wait and team_review. Revise the code task ONCE with a brief to fix the original sum.cjs fixture and run node --test again; collect its result. Then delegate one codex analysis task asking for an exhaustive detailed explanation of this fixture, and immediately call team_cancel on that new task before waiting. Finish with the exact marker formed by concatenating CHORUS_TEAM_ and COMPAT_COMPLETE, and a concise accurate summary. Do not call team_integrate.`
      let args = [...cli.args, ...(lead === 'claude'
        ? ['-p', '--output-format', 'stream-json', '--verbose', '--model', 'sonnet', '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--tools', '', '--allowedTools', ...names.map(n => `mcp__chorus-team__${n}`), '--strict-mcp-config', '--setting-sources', '', ...descriptor.args]
        : ['exec', '--ignore-user-config', '--ignore-rules', '--json', '--ephemeral', '--model', 'gpt-6-astra', '--sandbox', 'read-only', '-c', 'approval_policy="never"', '-c', 'windows.sandbox="elevated"', '-c', 'model_reasoning_effort="low"', '--disable', 'multi_agent', ...descriptor.args, ...names.flatMap(n => ['-c', `mcp_servers.chorus-team.tools.${n}.approval_mode="approve"`]), '-'])]
      const env = { ...composeHelperEnv(process.env, { envAdditions: {}, secretEnv: {} }), CHORUS_TEAM_ENDPOINT: endpoint, CHORUS_TEAM_TOKEN: token }
      if (interactive) args = [...cli.args, ...(lead === 'claude'
        ? ['--model', 'sonnet', '--permission-mode', 'dontAsk', '--tools', 'ToolSearch', '--allowedTools', ...names.map(n => `mcp__chorus-team__${n}`), '--strict-mcp-config', '--setting-sources', '', '--ax-screen-reader', ...descriptor.args, '--', prompt]
        : ['--model', 'gpt-6-astra', '--sandbox', 'read-only', '-a', 'never', '--no-alt-screen', '-c', 'windows.sandbox="elevated"', '-c', 'model_reasoning_effort="low"', '--disable', 'multi_agent', ...descriptor.args, ...names.flatMap(n => ['-c', `mcp_servers.chorus-team.tools.${n}.approval_mode="approve"`]), '--', prompt])]
      const child = spawn(interactive ? process.execPath : cli.file, interactive ? [path.join(root, 'scripts/team-pty-fixture.cjs')] : args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); owned.add(child); child.chorusStart = identity(child.pid)
      let out = '', err = ''
      let trustSent = false, completed = false, ptyExit = null
      const leadJournalStart = journal.length
      if (interactive) {
        readline.createInterface({ input: child.stdout }).on('line', line => {
          const message = JSON.parse(line)
          if (message.type === 'exit') ptyExit = message.exitCode
          if (message.type !== 'data') return
          out += message.data
          write(`${lead}-lead.terminal.log`, out)
          const plain = out.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
          // Consent applies only to this newly created disposable fixture; never a global bypass.
          if (!trustSent && /Yes, I trust this folder|Yes, continue|Trust this (?:folder|directory)/i.test(plain)) {
            trustSent = true; record('fixture-trust-accepted', { lead, cwd }); child.stdin.write(JSON.stringify({ type: 'write', data: lead === 'claude' ? 'y\r' : '\r' }) + '\n')
          }
          const flow = journal.slice(leadJournalStart)
          if (!completed && flow.some(e => e.type === 'tool-called' && e.name === 'team_cancel') && plain.includes('CHORUS_TEAM_COMPAT_COMPLETE')) {
            completed = true
            setTimeout(() => { if (!child.stdin.destroyed) child.stdin.write(JSON.stringify({ type: 'write', data: '\x03' }) + '\n') }, 1500)
            setTimeout(() => { if (!child.stdin.destroyed) child.stdin.write(JSON.stringify({ type: 'write', data: '\x03' }) + '\n') }, 1900)
          }
        })
      } else child.stdout.on('data', b => { out += b })
      child.stderr.on('data', b => { err += b })
      const timer = setTimeout(() => terminate(child), 360000)
      const controlFile = path.join(evidence, `${lead}-input.json`)
      const control = interactive ? setInterval(() => {
        if (!fs.existsSync(controlFile) || child.stdin.destroyed) return
        const data = JSON.parse(fs.readFileSync(controlFile, 'utf8')); fs.unlinkSync(controlFile)
        if (typeof data.text === 'string') child.stdin.write(JSON.stringify({ type: 'write', data: data.text }) + '\n')
      }, 300) : null
      if (interactive) child.stdin.write(JSON.stringify({ type: 'start', executable: cli.file, args, cwd }) + '\n')
      else child.stdin.end(prompt + '\n')
      const [code] = await once(child, 'close'); clearTimeout(timer); clearInterval(control); owned.delete(child)
      write(`${lead}-lead.jsonl`, out); write(`${lead}-lead.stderr.log`, err)
      record('lead-exited', { lead, code, ptyExit, transport: interactive ? 'interactive-pty' : 'structured-diagnostic', marker: out.includes('CHORUS_TEAM_COMPAT_COMPLETE') })
      if (code !== 0 || (interactive ? !completed : !out.includes('CHORUS_TEAM_COMPAT_COMPLETE'))) throw Error(`${lead} lead did not complete the compatibility flow.`)
    }
    await Promise.all([...tasks.values()].map(t => t.done))
    const outcomes = snapshot()
    const report = { mode: interactive ? 'live-interactive' : 'live-diagnostic', passed: peak === 2 && outcomes.some(t => t.attempt === 2 && t.tested) && outcomes.some(t => t.state === 'cancelled') && outcomes.filter(t => t.state !== 'cancelled').every(t => t.state === 'reviewable' && (t.kind !== 'code' || t.tested)) && outcomes.some(t => t.kind === 'analysis' && t.state === 'reviewable' && /subtract|a\s*-\s*b/i.test(t.summary) && /-1/.test(t.summary) && /5/.test(t.summary)), interactiveLeadProof: interactive, peakConcurrency: peak, tasks: outcomes, versions, at: new Date().toISOString() }
    write('live-report.json', report)
    console.log(JSON.stringify({ passed: report.passed, mode: report.mode, evidence }))
    if (!report.passed) throw Error('Live diagnostic assertions were not all satisfied.')
  } finally {
    for (const child of owned) try { terminate(child) } catch { /* evidence retains unknown process state */ }
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.unlinkSync(bundle)
  }
}
