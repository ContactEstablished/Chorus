// Model Routing Phase 0 (spike A), extended by Phase 4a (ImplementationSpec-4a-2).
// No provider traffic or credentials: point the installed OpenCode at a loopback
// stand-in and record what it would send to OpenRouter when Chorus adds an
// OpenRouter `provider` object to the per-model options. Covers Team helpers
// (`opencode run`, OPENCODE_CONFIG_CONTENT) and the interactive TUI
// (OPENCODE_CONFIG file + OPENCODE_CONFIG_CONTENT, via node-pty).
// The TUI cases are built from Chorus's REAL interactive builders —
// `resolveLaunchSelection`, `buildOpenCodeRoutingContent` and (K13)
// `unroutedNitroVariantsContent` on the golden `TierResult`,
// `opencodeAdapter.buildLaunch`, `opencodeAdapter.writeMcpConfig` and
// `composeChildEnv` — and the only harness change is pointing OpenRouter at the
// loopback stand-in. Each OpenCode run gets its own `XDG_STATE_HOME` and
// `XDG_DATA_HOME` (MR-G3); its config and cache directories are NOT isolated
// (`XDG_CONFIG_HOME`/`XDG_CACHE_HOME` are left to the user's own, exactly as
// before). The whole `%TEMP%\chorus-routing-body-*` evidence directory is
// deleted on every exit path, and the report is printed to stdout only (it holds
// no key: the only key-shaped value in a run is the placeholder in the child env,
// which is never recorded). Last line: `PASS (n checks)` (exit 0) or
// `FAIL (k of n checks)` (exit 1); a failed precondition throws (exit 1, no PASS
// line).
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
const ENTRY = [
  "export { opencodeHelper } from './src/main/adapters/helpers/opencode';",
  "export { composeHelperEnv } from './src/main/adapters/helpers/common';",
  "export { opencodeAdapter } from './src/main/adapters/opencode';",
  "export { composeChildEnv } from './src/main/adapters/env';",
  "export { opencodeStateHome } from './src/main/adapters/opencodeVariantStateCore';",
  "export { resolveLaunchSelection, buildOpenCodeRoutingContent, unroutedNitroVariantsContent } from './src/main/routing/launchCore';",
  "export { computeTiers } from './src/main/routing/routingCore';",
  "export { parseEndpointsResponse, extractObservations } from './src/main/routing/endpointsCore';",
  "export { bundledModelRegistry, findModel } from './src/main/routing/registryCore';",
  "export { DEFAULT_ROUTING_SETTINGS } from './src/shared/routing';"
].join('\n')
// Assigned from the bundle inside the `try` below, so a failed build still reaches the cleanup.
let opencodeHelper, composeHelperEnv, opencodeAdapter, composeChildEnv, opencodeStateHome
let resolveLaunchSelection, buildOpenCodeRoutingContent, unroutedNitroVariantsContent
let computeTiers, parseEndpointsResponse, extractObservations, bundledModelRegistry, findModel, DEFAULT_ROUTING_SETTINGS

const SLUG = 'deepseek/deepseek-v4.1-flash', NITRO = `${SLUG}:nitro`
const ROUTE = { order: ['atlas-cloud/fp8', 'deepinfra/fp8', 'morph/fp8'], allow_fallbacks: false, quantizations: ['fp8'], require_parameters: true }
const DENY = { data_collection: 'deny' }
const VARIANTS = { low: { reasoning: { effort: 'low' } }, medium: { reasoning: { effort: 'medium' } }, high: { reasoning: { effort: 'high' } } }
const MARK = 'ROUTING_PROBE_COMPLETE'
const GATEWAY = 'https://openrouter.ai/api/v1'
const CREDENTIAL = { envVarName: 'OPENROUTER_API_KEY', value: 'loopback-placeholder', isSecret: true }
// Hand-written expectations (never computed by the code under test): ImplementationSpec-4a-1 Tables L8 and L17.
const EXPECTED = {
  nitroUnrouted: '{"provider":{"openrouter":{"models":{"deepseek/deepseek-v4.1-flash:nitro":{"variants":{"low":{"reasoning":{"effort":"low"}},"medium":{"reasoning":{"effort":"medium"}},"high":{"reasoning":{"effort":"high"}}}}}}}}',
  balanced: '{"provider":{"openrouter":{"models":{"deepseek/deepseek-v4.1-flash":{"options":{"provider":{"order":["deepinfra/fp8","streamlake/fp8","makora/fp8"],"allow_fallbacks":false,"require_parameters":true,"quantizations":["fp8"],"data_collection":"deny"}}}}}}}',
  nitroVariants: '{"provider":{"openrouter":{"models":{"deepseek/deepseek-v4.1-flash:nitro":{"options":{"provider":{"data_collection":"deny"}},"variants":{"low":{"reasoning":{"effort":"low"}},"medium":{"reasoning":{"effort":"medium"}},"high":{"reasoning":{"effort":"high"}}}}}}}}',
  nitroBare: '{"provider":{"openrouter":{"models":{"deepseek/deepseek-v4.1-flash:nitro":{"options":{"provider":{"data_collection":"deny"}}}}}}}'
}
const SEEDED_HIGH = '{"recent":[],"favorite":[],"variant":{"openrouter/deepseek/deepseek-v4.1-flash":"high"}}'
const PATCHED_LOW = '{"recent":[],"favorite":[],"variant":{"openrouter/deepseek/deepseek-v4.1-flash":"low"}}'
// The golden TierResult's inputs (routingIpc.test.ts's recipe).
const FIXTURE = 'src/main/routing/__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json'
const CHECKED_AT = '2026-10-02T09:15:39Z', AT = '2026-10-02T09:20:00Z'

const requests = []
const tuiRuns = {}
const liveTerms = new Set()
let condition = '', server = null, baseURL = '', version = null, tuiStillRunning = false

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

const readText = file => { try { return fs.readFileSync(file, 'utf8') } catch { return null } }
const readBytes = file => { try { return fs.readFileSync(file) } catch { return null } }

// Interactive: built from Chorus's real builders. The caller passes the content the real
// builder made for the case; runTui never builds content itself.
async function runTui(name, sentModelId, configContent, { storedVariants, applyState }) {
  condition = name
  // Only XDG state and data are isolated; config and cache stay the user's own (unchanged from Phase 0).
  const sandbox = isolated(name, storedVariants)
  if (typeof configContent !== 'string') throw Error(`TUI ${name}: the builder returned no content, so the case would test nothing`)
  const request = opencodeAdapter.buildLaunch({ sessionId: name, cwd: process.cwd(), credential: CREDENTIAL, route: { providerKey: 'chorus', providerName: 'OpenRouter', baseUrl: GATEWAY, modelId: sentModelId }, modelEffortId: 'low', routing: { configContent } })
  // What a launch profile's env would contribute: MR-G3 isolation plus test hygiene.
  const profileEnv = { OPENCODE_DISABLE_AUTOUPDATE: 'true', OPENCODE_DISABLE_LSP_DOWNLOAD: 'true', ...sandbox.env }
  // The credentialed allow-list branch, exactly as the app composes it.
  const stateHome = opencodeStateHome(composeChildEnv({ parentEnv: process.env, requiredEnvVars: opencodeAdapter.requiredEnvVars, envAdditions: { ...request.envAdditions, ...profileEnv }, secretEnv: request.secretEnv }), os.homedir())
  const statePath = path.join(sandbox.env.XDG_STATE_HOME, 'opencode', 'model.json')
  const stateBefore = readText(statePath)
  // Pre-write guard (MR-G3): MR-D25 writes only into this run's sandbox, never anywhere else.
  if (applyState && path.resolve(stateHome) !== path.resolve(sandbox.env.XDG_STATE_HOME)) throw new Error(`TUI ${name}: the computed state home is not the isolated one; refusing to write`)
  const written = await opencodeAdapter.writeMcpConfig({ projectRoot: sandbox.root, chorusConfigDir: sandbox.root, servers: [], knownSecrets: [], agentDefaults: { modelId: sentModelId, baseUrl: GATEWAY, modelEffort: 'low' }, ...(applyState ? { cliState: { stateHome, installedVersion: version } } : {}) })
  if (!written.ok) throw Error(`TUI ${name}: writeMcpConfig refused (${written.reason})`)
  // Read BEFORE the TUI starts: the TUI rewrites its own state as it runs.
  const stateAfter = readText(statePath)
  const agent = JSON.parse(fs.readFileSync(written.path, 'utf8')).agent ?? null
  // The one harness patch (MR-G2): OpenRouter at the loopback stand-in, sharing off. The models entry is the builder's.
  const content = JSON.parse(request.envAdditions.OPENCODE_CONFIG_CONTENT)
  content.share = 'disabled'
  content.provider.openrouter.options = { baseURL }
  const env = composeChildEnv({ parentEnv: process.env, requiredEnvVars: opencodeAdapter.requiredEnvVars, envAdditions: { ...request.envAdditions, OPENCODE_CONFIG_CONTENT: JSON.stringify(content), ...profileEnv, OPENCODE_CONFIG: written.path }, secretEnv: request.secretEnv })
  tuiRuns[name] = { sentModelId, configContent, args: [...request.args], agent, stateHome, isolatedStateHome: sandbox.env.XDG_STATE_HOME, stateBefore, stateAfter }
  const term = pty.spawn(request.executable, [...request.args], { name: 'xterm-256color', cols: 120, rows: 36, cwd: process.cwd(), env })
  let hasExited = false
  const exited = new Promise(r => term.onExit(() => { hasExited = true; liveTerms.delete(term); r() })); liveTerms.add(term)
  let screen = ''; term.onData(d => { screen += d })
  // The text the TUI has drawn since byte `from`, with escape sequences removed.
  const drawn = (from = 0) => screen.slice(from).replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b[\]P_^X][\s\S]*?(?:\x07|\x1b\\)|\x1b[()*+].|\x1b./g, '')
  const before = requests.length
  const wait = async (test, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (test()) return true; await new Promise(r => setTimeout(r, 250)) } return false }
  try {
    // Ready means the prompt input itself is on screen (1.18.33's placeholder), not a byte count:
    // ~2 KB of terminal setup arrives ~0.8 s in but the prompt only ~3.2 s in (far later under load),
    // and keys typed before it exists are dropped without a trace (diagnosed 2026-10-04).
    if (!await wait(() => drawn().includes('Ask anything'), 60000)) throw Error(`TUI ${name} did not paint its prompt`)
    const typedAt = screen.length
    term.write(`Reply ${MARK}`)
    // Enter only once the input shows the text, so a lost keystroke fails as itself.
    if (!await wait(() => drawn(typedAt).includes(MARK), 10000)) throw Error(`TUI ${name} did not echo the typed prompt`)
    term.write('\r')
    // 60 s: the first submit initialises the project (watcher, project-copy refresh, snapshot) before any request: ~4 s idle, 30 s+ under load.
    if (!await wait(() => requests.slice(before).some(r => r.model === sentModelId), 60000)) throw Error(`TUI ${name} sent no request for ${sentModelId}`)
    await new Promise(r => setTimeout(r, 1500))
  } finally {
    // Killed at most once, and never after it exited: a second kill() on a ConPTY whose process is
    // already gone crashes node-pty's console-list agent ("AttachConsole failed") and took this
    // script down with it. Out of the live set FIRST, so the final cleanup can never kill it again.
    liveTerms.delete(term)
    if (!hasExited) { try { term.kill() } catch {} }
    // Let the TUI release its sandbox before the next case and before the evidence directory is deleted.
    let cap; const gone = await Promise.race([exited.then(() => true), new Promise(r => { cap = setTimeout(() => r(false), 15000) })]); clearTimeout(cap)
    if (!gone) { console.log(`# TUI ${name} was still running 15 s after the kill`); tuiStillRunning = true }
  }
}

const checks = []
const expect = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail })
let cleanupFailed = false
try {
  await require('esbuild').build({ stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'ts' }, outfile: bundle, bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
  ;({ opencodeHelper, composeHelperEnv, opencodeAdapter, composeChildEnv, opencodeStateHome, resolveLaunchSelection, buildOpenCodeRoutingContent, unroutedNitroVariantsContent, computeTiers, parseEndpointsResponse, extractObservations, bundledModelRegistry, findModel, DEFAULT_ROUTING_SETTINGS } = require(bundle))

  server = http.createServer((req, res) => {
    let body = ''; req.on('data', c => { body += c }); req.on('end', () => {
      let data = {}; try { data = JSON.parse(body) } catch {}
      requests.push({ condition, path: req.url, model: data.model ?? null, provider: data.provider ?? null, reasoning: data.reasoning ?? null, reasoning_effort: data.reasoning_effort ?? null, max_tokens: data.max_tokens ?? null, tools: data.tools?.length ?? 0, keys: Object.keys(data).sort() })
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(`data: ${JSON.stringify({ id: 'diagnostic', object: 'chat.completion.chunk', created: 1, model: data.model, choices: [{ index: 0, delta: { role: 'assistant', content: MARK }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\ndata: [DONE]\n\n`)
    })
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  baseURL = `http://127.0.0.1:${server.address().port}/api/v1`

  version = (await opencodeHelper.probe(new AbortController().signal)).version
  if (version !== '1.18.33') throw Error(`Expected OpenCode 1.18.33, found ${version}`)

  // The golden selections: the fixture through the real ranker, then the real resolution.
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
  const model = findModel(bundledModelRegistry(), SLUG)
  if (!model) throw Error(`The bundled registry has no ${SLUG}`)
  const snapshot = { fetchedAt: fixture.fetchedAt, endpoints: parseEndpointsResponse(fixture).endpoints }
  const golden = computeTiers({
    model,
    snapshot,
    history: extractObservations(snapshot),
    account: { guardrailRemoved: fixture.guardrailRemoved, dataPolicyRemoved: fixture.dataPolicyDenyRemoved, checkedAt: CHECKED_AT },
    cache: Object.fromEntries(Object.entries(fixture.cacheVerified).map(([tag, verified]) => [tag, { verified, checkedAt: CHECKED_AT }])),
    profile: 'interactive',
    effort: 'low',
    settings: DEFAULT_ROUTING_SETTINGS,
    now: AT
  })
  const resolve = tier => {
    const r = resolveLaunchSelection({ tier, model: SLUG, result: golden, settings: DEFAULT_ROUTING_SETTINGS, computedAt: AT })
    if (!r.ok) throw Error(`The golden ${tier} selection did not resolve: ${r.code}`)
    return r.selection
  }
  const BALANCED = resolve('balanced'), NITRO_SEL = resolve('nitro')

  // Real-state guard (MR-G3): the user's own model.json, as an un-isolated OpenCode would resolve it.
  // Computed WITHOUT opencodeStateHome (the function under test): XDG_STATE_HOME, else
  // <home>/.local/state, where os.homedir() follows USERPROFILE.
  const REAL_STATE = path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'opencode', 'model.json')
  const realBefore = readBytes(REAL_STATE)

  const LMH = ['low', 'medium', 'high']
  const routed = (selection, efforts) => buildOpenCodeRoutingContent(selection, efforts)
  await runHelper('helper-routed', SLUG, { provider: ROUTE })
  await runHelper('helper-nitro-deny', NITRO, { provider: DENY })
  await runTui('tui-routed', SLUG, routed(BALANCED, []), {})
  await runTui('tui-nitro-variants', NITRO, routed(NITRO_SEL, LMH), {})
  await runTui('tui-nitro-bare', NITRO, routed(NITRO_SEL, []), {})
  // K13: an UNROUTED :nitro launch with an effort — variants only, no provider object (ImplementationSpec-4a-1 L18's NBASE).
  await runTui('tui-nitro-unrouted', NITRO, unroutedNitroVariantsContent({ agent: 'opencode', baseUrl: GATEWAY, gatewayBaseUrl: GATEWAY, sentModelId: NITRO, launchEffort: 'low', catalogEfforts: LMH, profileEnvKeys: [] }), {})
  await runTui('tui-stored-variant', SLUG, routed(BALANCED, []), { storedVariants: { [`openrouter/${SLUG}`]: 'high' } })
  await runTui('tui-remembered-variant', SLUG, routed(BALANCED, []), { storedVariants: { [`openrouter/${SLUG}`]: 'high' }, applyState: true })

  const realAfter = readBytes(REAL_STATE)

  const main = c => requests.find(r => r.condition === c && (r.model === SLUG || r.model === NITRO))
  const a = main('helper-routed'), b = main('helper-nitro-deny'), c = main('tui-routed'), d = main('tui-nitro-variants'), e = main('tui-nitro-bare')
  const f = main('tui-nitro-unrouted'), g = main('tui-stored-variant'), h = main('tui-remembered-variant')
  const t = n => tuiRuns[n]
  const TUI_NAMES = ['tui-routed', 'tui-nitro-variants', 'tui-nitro-bare', 'tui-nitro-unrouted', 'tui-stored-variant', 'tui-remembered-variant']
  const sentAs = n => { const r = t(n), m = r.args[r.args.indexOf('-m') + 1]; return { m, agent: r.agent, ok: r.args.includes('-m') && m === `openrouter/${r.sentModelId}` && isDeepStrictEqual(r.agent, { build: { model: `openrouter/${r.sentModelId}`, variant: 'low' } }) } }
  expect('helper base slug carries the exact provider object', a && isDeepStrictEqual(a.provider, ROUTE), a?.provider)
  expect('helper base slug keeps low effort and the 64k cap', a?.reasoning?.effort === 'low' && a?.max_tokens === 64000, { reasoning: a?.reasoning, max_tokens: a?.max_tokens })
  expect('helper :nitro carries data_collection deny', b && isDeepStrictEqual(b.provider, DENY), b?.provider)
  expect('helper :nitro keeps low effort and the 64k cap', b?.reasoning?.effort === 'low' && b?.max_tokens === 64000, { reasoning: b?.reasoning, max_tokens: b?.max_tokens })
  expect('real builders: the Balanced and Nitro contents are the golden contents',
    t('tui-routed').configContent === EXPECTED.balanced && t('tui-nitro-variants').configContent === EXPECTED.nitroVariants && t('tui-nitro-bare').configContent === EXPECTED.nitroBare && t('tui-nitro-unrouted').configContent === EXPECTED.nitroUnrouted,
    Object.fromEntries(['tui-routed', 'tui-nitro-variants', 'tui-nitro-bare', 'tui-nitro-unrouted'].map(n => [n, t(n).configContent])))
  expect('real builders: -m and agent.build.model name the sent id', TUI_NAMES.every(n => sentAs(n).ok), Object.fromEntries(TUI_NAMES.map(n => [n, { m: sentAs(n).m, agent: sentAs(n).agent }])))
  expect('TUI routed: the real Balanced provider object arrives exactly', c && isDeepStrictEqual(c.provider, BALANCED.provider), { sent: c?.provider, expected: BALANCED.provider })
  expect('TUI base slug keeps the file-declared low effort', c?.reasoning?.effort === 'low', c?.reasoning)
  expect('TUI :nitro with declared variants keeps low effort and the provider object', d?.reasoning?.effort === 'low' && isDeepStrictEqual(d?.provider, { data_collection: 'deny' }), { reasoning: d?.reasoning, provider: d?.provider })
  expect('control: TUI :nitro without declared variants drops the effort', e && !e.reasoning?.effort, e?.reasoning)
  // Finding, not a routing requirement: without MR-D25 the TUI's remembered per-model variant beats agent.build.variant.
  expect('finding: without MR-D25 a remembered variant overrides agent.build.variant', g?.reasoning?.effort === 'high' && t('tui-stored-variant').stateAfter === t('tui-stored-variant').stateBefore, { reasoning: g?.reasoning, stateBefore: t('tui-stored-variant').stateBefore, stateAfter: t('tui-stored-variant').stateAfter })
  expect('MR-D25: the state home computed from the child env is the isolated one', t('tui-remembered-variant').stateHome === t('tui-remembered-variant').isolatedStateHome, { stateHome: t('tui-remembered-variant').stateHome, isolated: t('tui-remembered-variant').isolatedStateHome })
  expect('MR-D25: only the model entry changed in the state file', t('tui-remembered-variant').stateBefore === SEEDED_HIGH && t('tui-remembered-variant').stateAfter === PATCHED_LOW, { stateBefore: t('tui-remembered-variant').stateBefore, stateAfter: t('tui-remembered-variant').stateAfter })
  expect('MR-D25: the TUI sends the launch effort despite a stored high', h?.reasoning?.effort === 'low', h?.reasoning)
  expect('MR-G3: the real OpenCode state file is unchanged', (realBefore === null && realAfter === null) || (realBefore !== null && realAfter !== null && realBefore.equals(realAfter)), { existedBefore: realBefore !== null, existedAfter: realAfter !== null, bytesBefore: realBefore?.length ?? null, bytesAfter: realAfter?.length ?? null })
  expect('K13: an unrouted :nitro launch with an effort keeps it, with no provider object', f?.reasoning?.effort === 'low' && f?.provider === null, { reasoning: f?.reasoning, provider: f?.provider })

  const report = { passed: checks.every(x => x.ok), version, checks, requests, tuiRuns, providerTraffic: false }
  console.log(JSON.stringify(report, null, 2))
} finally {
  for (const term of liveTerms) { try { term.kill() } catch {} }
  if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)) }
  try { fs.rmSync(bundle, { force: true }) } catch (err) { console.log(`# cleanup failed: ${bundle} was not deleted (${err.message})`); cleanupFailed = true; process.exitCode = 1 }
  try {
    fs.rmSync(evidence, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    if (fs.existsSync(evidence)) throw Error('it still exists after the delete')
  } catch (err) {
    console.log(`# cleanup failed: ${evidence} was not deleted (${err.message})`)
    cleanupFailed = true
    process.exitCode = 1
  }
}
const failed = checks.filter(x => !x.ok).length
const allPassed = failed === 0 && !cleanupFailed && !tuiStillRunning
console.log(allPassed ? `PASS (${checks.length} checks)` : `FAIL (${failed} of ${checks.length} checks)`)
process.exitCode = allPassed ? 0 : 1
