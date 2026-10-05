// Native model/MCP long-call diagnostic. Production TeamRuntime is tested separately.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url), root = process.cwd()
const model = process.argv[2] ?? 'gpt-6-astra'
assert(['gpt-6-astra', 'gpt-6.1-sol'].includes(model))
const explicitYield = process.argv.includes('--wrapper-yield')
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-codex-team-client-'))
const bundle = path.join(root, '_verify', `codex-team-client-${Date.now()}.cjs`)
await require('esbuild').build({ stdin: { contents: `export { codexAdapter } from './src/main/adapters/codex'; export { buildTeamLeadConfiguration } from './src/main/adapters/teamLead'; export { decisionWaitCodexVersion } from './src/shared/team'; export { findCodexPilotTranscript, summarizeCodexPilotTranscript } from './scripts/team-codex-audit';`, resolveDir: root, loader: 'ts' }, outfile: bundle, bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
const { codexAdapter, buildTeamLeadConfiguration, decisionWaitCodexVersion, findCodexPilotTranscript, summarizeCodexPilotTranscript } = require(bundle)
const version = (await codexAdapter.detectInstallation()).version
assert(decisionWaitCodexVersion(version), `Codex ${version} needs exact-version long-wait qualification`)
const token = randomUUID(), sessionId = randomUUID(), timers = new Set()
const toolNames = ['team_roster', 'team_delegate', 'team_status', 'team_wait', 'team_review', 'team_revise', 'team_integrate', 'team_cancel', 'team_detail', 'team_verify', 'team_finish', 'team_delegate_many', 'team_review_many']
let firstWait = 0, segments = 0, readyAt = 0, unauthorized = 0
const server = http.createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`) { unauthorized++; res.writeHead(403).end(); return }
  let text = ''; req.on('data', b => { text += b })
  req.on('end', () => {
    const data = JSON.parse(text), reply = result => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, result })) }
    if (data.method === 'tools/list') { reply({ tools: toolNames.map(name => ({ name, description: name === 'team_wait' ? 'Wait for a decision-ready result. Use target results and timeoutMs 900000 in this diagnostic.' : 'Unused in this diagnostic.', inputSchema: { type: 'object', properties: { target: { type: 'string' }, timeoutMs: { type: 'integer' } }, additionalProperties: false }, annotations: { readOnlyHint: true } })) }); return }
    assert.equal(data.name, 'team_wait'); assert.equal(data.arguments.target, 'results')
    if (!firstWait) firstWait = Date.now()
    segments++
    const remaining = 75000 - (Date.now() - firstWait)
    const timer = setTimeout(() => { timers.delete(timer); const ready = Date.now() - firstWait >= 75000; if (ready) readyAt = Date.now(); reply({ wakeReason: ready ? 'ready' : 'timeout', marker: ready ? 'CODEX_LONG_WAIT_READY' : null }) }, Math.min(data.arguments.timeoutMs, Math.max(1, remaining)))
    timers.add(timer); res.on('close', () => { clearTimeout(timer); timers.delete(timer) })
  })
})
server.listen(0, '127.0.0.1'); await once(server, 'listening')
const descriptor = buildTeamLeadConfiguration({ lead: 'codex', worktree: evidence, configDirectory: path.join(path.dirname(evidence), `${path.basename(evidence)}-config`), nodeExecutable: process.execPath, bridgeScript: path.join(root, 'resources/teamBridge.cjs'), verifiedVersion: version })
const request = codexAdapter.buildLaunch({ cwd: evidence, sessionId, permissionModeId: 'manual' })
const args = [...request.args, '-m', model, '-c', 'model_reasoning_effort="medium"', '-c', 'features.multi_agent=false', '-c', 'windows.sandbox="elevated"', ...descriptor.args, '-c', 'mcp_servers.chorus-team.tools.team_wait.approval_mode="approve"', 'exec', '--skip-git-repo-check', '--json', '-']
const started = Date.now()
const child = spawn(request.executable, args, { cwd: evidence, windowsHide: true, env: { ...process.env, ...request.envAdditions, CHORUS_TEAM_ENDPOINT: `http://127.0.0.1:${server.address().port}/team`, CHORUS_TEAM_TOKEN: token }, stdio: ['pipe', 'pipe', 'pipe'] })
console.log(JSON.stringify({ evidence, model, version, pid: child.pid }))
let stdout = '', stderr = ''
child.stdout.on('data', b => { stdout += b; fs.writeFileSync(path.join(evidence, 'native.jsonl'), stdout) }); child.stderr.on('data', b => { stderr += b })
child.stdin.end('Call chorus-team team_wait exactly once with target results and timeoutMs 900000. Keep this single tool call open until it returns CODEX_LONG_WAIT_READY; do not poll or use shell, other tools or native agents. Once it returns, finish with CODEX_LONG_WAIT_COMPLETE.' + (explicitYield ? '\nFor the outer functions.exec wrapper, put // @exec: {"yield_time_ms": 120000} on its first line so the initial call can span readiness. The inner timeoutMs does not configure this wrapper. If it still yields, resume that same cell with functions.wait; never start another Team wait. Preserve cancellation and actionable failure handling.' : ''))
const timeout = setTimeout(() => child.kill(), 240000)
try {
  const [code] = await once(child, 'close')
  const events = stdout.split('\n').filter(Boolean).map(line => JSON.parse(line))
  const waitCalls = events.filter(e => e.type === 'item.started' && e.item?.type === 'mcp_tool_call' && e.item.server === 'chorus-team' && e.item.tool === 'team_wait').length
  const completed = stdout.split('\n').some(line => { try { const e = JSON.parse(line); return e.type === 'item.completed' && e.item?.type === 'agent_message' && e.item.text.includes('CODEX_LONG_WAIT_COMPLETE') } catch { return false } })
  assert.equal(code, 0); assert(completed); assert(readyAt - firstWait >= 75000); assert.equal(segments, 4); assert.equal(waitCalls, 1); assert.equal(unauthorized, 0)
  const conversationId = events.find(e => e.type === 'thread.started')?.thread_id
  assert(conversationId, 'Missing native conversation identity')
  const transcript = findCodexPilotTranscript(conversationId, evidence, sessionId, started)
  const audit = summarizeCodexPilotTranscript(transcript, conversationId, evidence, sessionId)
  assert.equal(audit.coverage, 'verified-thread', 'Request accounting must reconcile the exact owned thread')
  const rows = transcript.split('\n').filter(Boolean).map(line => JSON.parse(line))
  const calls = rows.filter(r => r.type === 'response_item' && ['function_call', 'custom_tool_call'].includes(r.payload?.type)).map(r => r.payload)
  const wrapperResumptions = calls.filter(c => /^(functions\.)?wait$/.test(c.name)).length
  const wrapperCalls = calls.filter(c => /^(functions\.)?(exec|wait)$/.test(c.name)).map(c => ({ name: c.name, yieldMs: [...String(c.input ?? c.arguments ?? '').matchAll(/yield_time_ms[^0-9]{0,8}(\d+)/g)].map(m => Number(m[1])) }))
  const report = { passed: true, explicitYield, wrapperResumptions, modelRequests: audit.modelRequests, wrapperCalls, leadUsage: audit.usage, zeroWrapperResumptions: wrapperResumptions === 0, model, version, effort: 'medium', nativeWaitCalls: waitCalls, brokerSegments: segments, waitMs: readyAt - firstWait, completed, evidence, transport: 'native Codex exec, production launch adapter and Teams facade; synthetic broker readiness' }
  fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report))
} catch (error) { fs.writeFileSync(path.join(evidence, 'failure.json'), JSON.stringify({ passed: false, model, message: String(error), segments, stderr: stderr.split(token).join('[REDACTED]') }, null, 2)); process.exitCode = 1 }
finally { clearTimeout(timeout); for (const timer of timers) clearTimeout(timer); server.closeAllConnections(); await new Promise(r => server.close(r)); fs.unlinkSync(bundle) }
