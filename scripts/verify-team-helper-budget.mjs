// No provider traffic or credentials: interrogate the exact native client's HTTP
// serialization against a loopback stand-in, retaining only numeric/model metadata.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
const require = createRequire(import.meta.url), evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-helper-budget-'))
const bundle = path.resolve('_verify', `helper-budget-${Date.now()}.cjs`)
await require('esbuild').build({ stdin: { contents: "export { opencodeHelper } from './src/main/adapters/helpers/opencode'; export { composeHelperEnv } from './src/main/adapters/helpers/common';", resolveDir: process.cwd(), loader: 'ts' }, outfile: bundle, bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
const { opencodeHelper, composeHelperEnv } = require(bundle), requests = []
let condition = ''
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c }); req.on('end', () => {
    const data = JSON.parse(body)
    requests.push({ condition, model: data.model, max_tokens: data.max_tokens ?? null, max_completion_tokens: data.max_completion_tokens ?? null, reasoning: data.reasoning ?? null, reasoning_effort: data.reasoning_effort ?? null, tools: data.tools?.length ?? 0 })
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(`data: ${JSON.stringify({ id: 'diagnostic', object: 'chat.completion.chunk', created: 1, model: data.model, choices: [{ index: 0, delta: { role: 'assistant', content: 'BUDGET_PROBE_COMPLETE' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\ndata: [DONE]\n\n`)
  })
})
server.listen(0, '127.0.0.1'); await once(server, 'listening')
try {
  const versions = await opencodeHelper.probe(new AbortController().signal)
  for (const [variant, cap, installedVersion, nitro] of [[undefined, undefined, undefined], ['low', undefined, undefined], ['low', '64000', undefined], ['low', undefined, '1.18.33'], ['low', undefined, '1.18.33', true]]) {
    condition = nitro ? 'qualified-nitro-low' : installedVersion ? 'qualified-low' : cap ? `low-${cap}` : variant ?? 'default'
    const request = opencodeHelper.buildExecution({ attemptId: condition, cwd: evidence, kind: 'code', brief: 'Respond BUDGET_PROBE_COMPLETE without tools.', model: 'deepseek/deepseek-v4.1-flash' + (nitro ? ':nitro' : ''), installedVersion, effort: variant, route: { baseUrl: 'https://openrouter.ai/api/v1' }, credential: { envVarName: 'OPENROUTER_API_KEY', value: 'loopback-placeholder' }, allowedCommands: [], signal: new AbortController().signal })
    const config = JSON.parse(request.envAdditions.OPENCODE_CONFIG_CONTENT)
    config.provider.openrouter.options = { baseURL: `http://127.0.0.1:${server.address().port}/api/v1` }
    request.envAdditions.OPENCODE_CONFIG_CONTENT = JSON.stringify(config)
    const env = composeHelperEnv(process.env, request)
    if (cap) env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = cap
    const child = spawn(request.executable, request.args, { cwd: evidence, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''; child.stdout.on('data', c => { stdout += c }); child.stderr.on('data', c => { stderr += c })
    child.stdin.end(request.stdin)
    const timer = setTimeout(() => child.kill(), 60000), [code] = await once(child, 'close'); clearTimeout(timer)
    if (code !== 0 || !stdout.includes('BUDGET_PROBE_COMPLETE')) throw Error(`Native ${condition} probe failed: ${stderr.slice(-1000)}`)
  }
  const helpers = requests.filter(r => ['deepseek/deepseek-v4.1-flash', 'deepseek/deepseek-v4.1-flash:nitro'].includes(r.model))
  const report = { passed: helpers.length === 5 && helpers.every(r => r.max_tokens === (['low-64000', 'qualified-low', 'qualified-nitro-low'].includes(r.condition) ? 64000 : 32000)) && helpers.filter(r => r.condition.includes('low')).every(r => r.reasoning?.effort === 'low'), version: versions.version, requests, evidence, providerTraffic: false }
  fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); process.exitCode = report.passed ? 0 : 1
} finally { server.closeAllConnections(); await new Promise(r => server.close(r)); fs.unlinkSync(bundle) }
