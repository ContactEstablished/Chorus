// Native relative-path contract, deterministic loopback responses, no provider use.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
const require = createRequire(import.meta.url), evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-helper-paths-'))
const bundle = path.resolve('_verify', `helper-paths-${Date.now()}.cjs`)
await require('esbuild').build({ stdin: { contents: "export { opencodeHelper } from './src/main/adapters/helpers/opencode'; export { composeHelperEnv } from './src/main/adapters/helpers/common';", resolveDir: process.cwd(), loader: 'ts' }, outfile: bundle, bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
const { opencodeHelper, composeHelperEnv } = require(bundle)
fs.writeFileSync(path.join(evidence, 'fixture.cjs'), 'exports.value=1;\n')
const calls = [['read', { filePath: 'fixture.cjs' }], ['write', { filePath: 'fixture.cjs', content: 'exports.value=2;\n' }], ['edit', { filePath: 'fixture.cjs', oldString: 'value=2', newString: 'value=3' }], ['glob', { pattern: '*.cjs' }], ['grep', { pattern: 'value=3', path: '.' }]]
let count = 0, descriptions = {}, systemGuardDelivered = false
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c }); req.on('end', () => {
    const data = JSON.parse(body), isHelper = data.model === 'deepseek/deepseek-v4.1-flash:nitro'
    if (isHelper) {
      descriptions = Object.fromEntries((data.tools ?? []).filter(t => t.function?.parameters?.properties?.filePath).map(t => [t.function.name, t.function.parameters.properties.filePath.description]))
      systemGuardDelivered ||= data.messages?.some(m => m.role === 'system' && JSON.stringify(m.content).includes('CHORUS BOUNDED HELPER')) ?? false
    }
    const call = isHelper ? calls[count++] : undefined
    const delta = call ? { role: 'assistant', tool_calls: [{ index: 0, id: `probe_${count}`, type: 'function', function: { name: call[0], arguments: JSON.stringify(call[1]) } }] } : { role: 'assistant', content: 'RELATIVE_PATH_PROBE_COMPLETE' }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(`data: ${JSON.stringify({ id: `probe_${count}`, object: 'chat.completion.chunk', created: 1, model: data.model, choices: [{ index: 0, delta, finish_reason: call ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\ndata: [DONE]\n\n`)
  })
})
server.listen(0, '127.0.0.1'); await once(server, 'listening')
try {
  const version = (await opencodeHelper.probe(new AbortController().signal)).version
  const request = opencodeHelper.buildExecution({ attemptId: 'relative-probe', cwd: evidence, kind: 'code', brief: 'Read and update fixture.cjs using relative native paths. No shell commands.', model: 'deepseek/deepseek-v4.1-flash:nitro', installedVersion: version, effort: 'low', route: { baseUrl: 'https://openrouter.ai/api/v1' }, credential: { envVarName: 'OPENROUTER_API_KEY', value: 'loopback-placeholder' }, allowedCommands: [], signal: new AbortController().signal })
  const config = JSON.parse(request.envAdditions.OPENCODE_CONFIG_CONTENT)
  config.provider.openrouter.options = { baseURL: `http://127.0.0.1:${server.address().port}/api/v1` }
  request.envAdditions.OPENCODE_CONFIG_CONTENT = JSON.stringify(config)
  const child = spawn(request.executable, request.args, { cwd: evidence, env: composeHelperEnv(process.env, request), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''; child.stdout.on('data', c => { stdout += c }); child.stderr.on('data', c => { stderr += c }); child.stdin.end(request.stdin)
  const timer = setTimeout(() => child.kill(), 60000), [code] = await once(child, 'close'); clearTimeout(timer)
  fs.writeFileSync(path.join(evidence, 'native.jsonl'), stdout)
  const records = stdout.split('\n').filter(Boolean).map(l => JSON.parse(l)), tools = records.filter(r => r.type === 'tool_use').map(r => ({ tool: r.part.tool, status: r.part.state.status, error: r.part.state.error ?? null }))
  assert.equal(code, 0, stderr.slice(-1000)); assert.equal(count, calls.length + 1); assert.equal(tools.length, calls.length)
  assert(tools.every(t => t.status === 'completed'), JSON.stringify(tools)); assert.equal(fs.readFileSync(path.join(evidence, 'fixture.cjs'), 'utf8'), 'exports.value=3;\n')
  assert(systemGuardDelivered, 'The native request must carry the helper contract as a system prompt')
  const report = { passed: true, version, tools, descriptions, systemGuardDelivered, relativePathsSupported: true, providerTraffic: false, evidence }
  fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2))
} finally { server.closeAllConnections(); await new Promise(r => server.close(r)); fs.unlinkSync(bundle) }
