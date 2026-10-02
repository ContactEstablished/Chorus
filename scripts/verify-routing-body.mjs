// Model Routing Phase 0 (spike A). No provider traffic or credentials: point the
// installed OpenCode at a loopback stand-in and record what it would send to
// OpenRouter when Chorus adds an OpenRouter `provider` object to the per-model
// options. Covers Team helpers (`opencode run`, OPENCODE_CONFIG_CONTENT) and the
// interactive TUI (OPENCODE_CONFIG file + OPENCODE_CONFIG_CONTENT, via node-pty).
// Every run gets its own XDG_STATE_HOME/XDG_DATA_HOME so the user's TUI state
// (per-model variant memory, prompt history, sessions) is neither read nor written.
// Usage: node scripts/verify-routing-body.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { isDeepStrictEqual } from 'node:util'
const require = createRequire(import.meta.url), pty = require('node-pty')
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-routing-body-'))
const bundle = path.resolve('_verify', `routing-body-${Date.now()}.cjs`)
await require('esbuild').build({ stdin: { contents: "export { opencodeHelper } from './src/main/adapters/helpers/opencode'; export { composeHelperEnv } from './src/main/adapters/helpers/common';", resolveDir: process.cwd(), loader: 'ts' }, outfile: bundle, bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
const { opencodeHelper, composeHelperEnv } = require(bundle)

const SLUG = 'deepseek/deepseek-v4.1-flash', NITRO = `${SLUG}:nitro`
const ROUTE = { order: ['atlas-cloud/fp8', 'deepinfra/fp8', 'morph/fp8'], allow_fallbacks: false, quantizations: ['fp8'], require_parameters: true }
const DENY = { data_collection: 'deny' }
const VARIANTS = { low: { reasoning: { effort: 'low' } }, medium: { reasoning: { effort: 'medium' } }, high: { reasoning: { effort: 'high' } } }
const MARK = 'ROUTING_PROBE_COMPLETE'

const requests = []
let condition = ''
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c }); req.on('end', () => {
    let data = {}; try { data = JSON.parse(body) } catch {}
    requests.push({ condition, path: req.url, model: data.model ?? null, provider: data.provider ?? null, reasoning: data.reasoning ?? null, reasoning_effort: data.reasoning_effort ?? null, max_tokens: data.max_tokens ?? null, tools: data.tools?.length ?? 0, keys: Object.keys(data).sort() })
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(`data: ${JSON.stringify({ id: 'diagnostic', object: 'chat.completion.chunk', created: 1, model: data.model, choices: [{ index: 0, delta: { role: 'assistant', content: MARK }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\ndata: [DONE]\n\n`)
  })
})
server.listen(0, '127.0.0.1'); await once(server, 'listening')
const baseURL = `http://127.0.0.1:${server.address().port}/api/v1`

function helperRequest(model, options) {
  const request = opencodeHelper.buildExecution({ attemptId: condition, cwd: evidence, kind: 'code', brief: `Respond ${MARK} without tools.`, model, installedVersion: '1.18.33', effort: 'low', route: { baseUrl: 'https://openrouter.ai/api/v1' }, credential: { envVarName: 'OPENROUTER_API_KEY', value: 'loopback-placeholder' }, allowedCommands: [], signal: new AbortController().signal })
  const config = JSON.parse(request.envAdditions.OPENCODE_CONFIG_CONTENT)
  config.provider.openrouter.options = { baseURL }
  // The Phase 4 change under test: the routing object rides in the per-model options.
  config.provider.openrouter.models[model] = { ...config.provider.openrouter.models[model], options }
  request.envAdditions.OPENCODE_CONFIG_CONTENT = JSON.stringify(config)
  return request
}

function isolated(name, storedVariants) {
  const root = fs.mkdtempSync(path.join(evidence, `${name}-`)), state = path.join(root, 'state'), data = path.join(root, 'data')
  fs.mkdirSync(path.join(state, 'opencode'), { recursive: true }); fs.mkdirSync(data)
  if (storedVariants) fs.writeFileSync(path.join(state, 'opencode', 'model.json'), JSON.stringify({ recent: [], favorite: [], variant: storedVariants }))
  return { root, env: { XDG_STATE_HOME: state, XDG_DATA_HOME: data } }
}

async function runHelper(name, model, options) {
  condition = name
  const request = helperRequest(model, options)
  const child = spawn(request.executable, request.args, { cwd: evidence, env: { ...composeHelperEnv(process.env, request), ...isolated(name).env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''; child.stdout.on('data', c => { stdout += c }); child.stderr.on('data', c => { stderr += c })
  child.stdin.end(request.stdin)
  const timer = setTimeout(() => child.kill(), 60000), [code] = await once(child, 'close'); clearTimeout(timer)
  if (code !== 0 || !stdout.includes(MARK)) throw Error(`Helper ${name} failed (${code}): ${stderr.slice(-800)}`)
  return request
}

// Interactive: Chorus writes agent.build {model, variant} into the shared
// OPENCODE_CONFIG file today; routing would arrive separately per process.
async function runTui(name, model, { variant, modelOptions, storedVariants }) {
  condition = name
  const sandbox = isolated(name, storedVariants)
  const file = path.join(sandbox.root, 'opencode.json')
  fs.writeFileSync(file, JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp: {}, agent: { build: { model: `openrouter/${model}`, variant } } }))
  const content = { share: 'disabled', provider: { openrouter: { options: { baseURL }, models: { [model]: modelOptions } } } }
  const exe = helperRequest(SLUG, {}).executable
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', OPENROUTER_API_KEY: 'loopback-placeholder', OPENCODE_CONFIG: file, OPENCODE_CONFIG_CONTENT: JSON.stringify(content), OPENCODE_DISABLE_AUTOUPDATE: 'true', OPENCODE_DISABLE_LSP_DOWNLOAD: 'true', ...sandbox.env }
  const term = pty.spawn(exe, ['-m', `openrouter/${model}`], { name: 'xterm-256color', cols: 120, rows: 36, cwd: process.cwd(), env })
  let screen = ''; term.onData(d => { screen += d })
  const before = requests.length
  const wait = async (test, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (test()) return true; await new Promise(r => setTimeout(r, 250)) } return false }
  try {
    if (!await wait(() => screen.length > 2000, 30000)) throw Error(`TUI ${name} did not paint`)
    await new Promise(r => setTimeout(r, 2500))
    term.write(`Reply ${MARK}`); await new Promise(r => setTimeout(r, 400)); term.write('\r')
    if (!await wait(() => requests.slice(before).some(r => r.model === model), 30000)) throw Error(`TUI ${name} sent no request for ${model}`)
    await new Promise(r => setTimeout(r, 1500))
  } finally { term.kill() }
}

const checks = []
const expect = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail })
try {
  const version = (await opencodeHelper.probe(new AbortController().signal)).version
  if (version !== '1.18.33') throw Error(`Expected OpenCode 1.18.33, found ${version}`)

  await runHelper('helper-routed', SLUG, { provider: ROUTE })
  await runHelper('helper-nitro-deny', NITRO, { provider: DENY })
  await runTui('tui-routed', SLUG, { variant: 'low', modelOptions: { options: { provider: ROUTE } } })
  await runTui('tui-nitro-variants', NITRO, { variant: 'low', modelOptions: { variants: VARIANTS, options: { provider: DENY } } })
  await runTui('tui-nitro-bare', NITRO, { variant: 'low', modelOptions: {} })
  await runTui('tui-stored-variant', SLUG, { variant: 'low', modelOptions: { options: { provider: ROUTE } }, storedVariants: { [`openrouter/${SLUG}`]: 'high' } })

  const main = c => requests.find(r => r.condition === c && (r.model === SLUG || r.model === NITRO))
  const a = main('helper-routed'), b = main('helper-nitro-deny'), c = main('tui-routed'), d = main('tui-nitro-variants'), e = main('tui-nitro-bare'), f = main('tui-stored-variant')
  expect('helper base slug carries the exact provider object', a && isDeepStrictEqual(a.provider, ROUTE), a?.provider)
  expect('helper base slug keeps low effort and the 64k cap', a?.reasoning?.effort === 'low' && a?.max_tokens === 64000, { reasoning: a?.reasoning, max_tokens: a?.max_tokens })
  expect('helper :nitro carries data_collection deny', b && isDeepStrictEqual(b.provider, DENY), b?.provider)
  expect('helper :nitro keeps low effort and the 64k cap', b?.reasoning?.effort === 'low' && b?.max_tokens === 64000, { reasoning: b?.reasoning, max_tokens: b?.max_tokens })
  expect('TUI merges OPENCODE_CONFIG_CONTENT routing over the OPENCODE_CONFIG file', c && isDeepStrictEqual(c.provider, ROUTE), c?.provider)
  expect('TUI base slug keeps the file-declared low effort', c?.reasoning?.effort === 'low', c?.reasoning)
  expect('TUI :nitro with declared variants keeps low effort and the provider object', d?.reasoning?.effort === 'low' && isDeepStrictEqual(d?.provider, DENY), { reasoning: d?.reasoning, provider: d?.provider })
  expect('control: TUI :nitro without declared variants drops the effort', e && !e.reasoning?.effort, e?.reasoning)
  // Finding, not a routing requirement: the TUI's remembered per-model variant beats agent.build.variant.
  expect('finding: a variant remembered in TUI state overrides the Chorus-written agent.build.variant', f?.reasoning?.effort === 'high', f?.reasoning)

  const report = { passed: checks.every(x => x.ok), version, checks, requests, evidence, providerTraffic: false }
  fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); process.exitCode = report.passed ? 0 : 1
} finally { server.closeAllConnections(); await new Promise(r => server.close(r)); fs.unlinkSync(bundle) }
