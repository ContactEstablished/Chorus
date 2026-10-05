// Model Routing Phase 0 (spike B), Electron main. Spends a few cents of real
// OpenRouter credit. The key is decrypted through the production vault from a
// copied credential, held in one const, sent only as a bearer header or the
// child's OPENROUTER_API_KEY, and never written to the report.
// Run through scripts/verify-routing-live.mjs, not directly.
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { StorageService } from '../src/main/services/storage'
import { CredentialVault } from '../src/main/services/vault'
import { opencodeHelper } from '../src/main/adapters/helpers/opencode'
import { composeHelperEnv } from '../src/main/adapters/helpers/common'
import { copyFixtureCredential } from './team-fixture-credential'

const evidence = process.env.CHORUS_ROUTING_EVIDENCE!
app.setPath('userData', path.join(evidence, 'profile'))
const SLUG = 'deepseek/deepseek-v4.1-flash', API = 'https://openrouter.ai/api/v1'
const TOOL = { type: 'function', function: { name: 'record_answer', description: 'Record a short answer.', parameters: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] } } }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

app.whenReady().then(async () => {
  const report: Record<string, unknown> = { startedAt: new Date().toISOString() }
  const write = () => fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  try {
    const owner = new StorageService(path.join(evidence, 'routing-live.db'))
    const profileId = copyFixtureCredential(process.env.CHORUS_ROUTING_SOURCE_DB!, owner)
    const credential = await new CredentialVault(owner).decryptForLaunch(profileId)
    if (!credential.ok) throw Error(`Credential unavailable: ${credential.kind}`)
    const key = credential.value.key
    const auth = { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-title': 'Chorus routing spike' }

    // (e) pricing.overrides units: one call pinned to DeepSeek first-party, whose
    // weekday windows read as HHMM and as minutes-of-day disagree before 10:00 UTC.
    if (process.env.CHORUS_ROUTING_PRICING === '1') {
      const pricing = []
      for (let i = 0; i < 2; i++) {
        const at = new Date().toISOString()
        const res = await fetch(`${API}/chat/completions`, { method: 'POST', headers: auth, body: JSON.stringify({ model: SLUG, provider: { order: ['deepseek'], allow_fallbacks: false }, messages: [{ role: 'user', content: 'Reply with the single word OK.' }], reasoning: { effort: 'low' }, max_tokens: 200 }) })
        const body = await res.json() as Record<string, any>
        pricing.push({ at, status: res.status, servedBy: body.provider ?? null, usage: body.usage ?? null, error: body.error?.message ?? null })
      }
      report.pricing = pricing
      // A zero price ceiling removes every endpoint, so the 404 costs nothing and
      // its message names each removal, including account guardrails.
      const preflight = []
      for (const provider of [{ max_price: { prompt: 0, completion: 0 } }, { order: ['chorus-preflight-none'], allow_fallbacks: false }, { only: ['chorus-preflight-none'] }]) {
        const res = await fetch(`${API}/chat/completions`, { method: 'POST', headers: auth, body: JSON.stringify({ model: SLUG, provider, messages: [{ role: 'user', content: 'OK' }], max_tokens: 1 }) })
        const body = await res.json() as Record<string, any>
        preflight.push({ provider, status: res.status, message: body.error?.message ?? null, metadata: body.error?.metadata ?? null, usage: body.usage ?? null })
      }
      report.guardrailPreflight = preflight
      report.passed = true; return
    }

    // Council MR-1.0 follow-ups: per-endpoint prompt caching, the data-policy
    // filter's reach, and whether a removed first `order` entry falls through.
    if (process.env.CHORUS_ROUTING_COUNCIL === '1') {
      const preflight = async (extra: Record<string, unknown>) => {
        const res = await fetch(`${API}/chat/completions`, { method: 'POST', headers: auth, body: JSON.stringify({ model: SLUG, provider: { order: ['chorus-preflight-none'], allow_fallbacks: false, ...extra }, messages: [{ role: 'user', content: 'OK' }], max_tokens: 1 }) })
        const body = await res.json() as Record<string, any>
        return { extra, status: res.status, message: body.error?.message ?? null, funnel: body.error?.metadata?.routing_funnel ?? null, usage: body.usage ?? null }
      }
      report.dataPolicyPreflight = [await preflight({}), await preflight({ data_collection: 'deny' })]
      write()
      const fallthrough = []
      for (const order of [['deepseek', 'deepinfra/fp8'], ['chorus-preflight-none', 'atlas-cloud/fp8']]) {
        const res = await fetch(`${API}/chat/completions`, { method: 'POST', headers: auth, body: JSON.stringify({ model: SLUG, provider: { order, allow_fallbacks: false }, messages: [{ role: 'user', content: 'Reply with the single word OK.' }], reasoning: { effort: 'low' }, max_tokens: 200 }) })
        const body = await res.json() as Record<string, any>
        fallthrough.push({ order, status: res.status, servedBy: body.provider ?? null, error: body.error?.message?.slice(0, 300) ?? null, cost: body.usage?.cost ?? null })
      }
      report.fallthrough = fallthrough
      write()
      // ~3,000-token deterministic prefix; a per-endpoint nonce makes the first call cold.
      const filler = Array.from({ length: 220 }, (_, i) => `export function step${i}(value: number): number { return value * ${i + 3} + ${(i * 7) % 11}; }`).join('\n')
      const tags = ['atlas-cloud/fp8', 'gmicloud/fp8', 'deepinfra/fp8', 'venice/fp8', 'baidu/fp8', 'streamlake/fp8', 'parasail/fp8', 'nextbit/fp8', 'makora/fp8', 'novita/fp8', 'baseten/fp8', 'morph/fp8', 'siliconflow/fp8', 'baseten/fast', 'together']
      const probeTag = async (tag: string) => {
        const nonce = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const messages = [{ role: 'system', content: `Session ${nonce}. Reference module follows.\n${filler}` }, { role: 'user', content: 'Reply with the single word OK.' }]
        const samples = []
        for (let i = 0; i < 3; i++) {
          const res = await fetch(`${API}/chat/completions`, { method: 'POST', headers: auth, body: JSON.stringify({ model: SLUG, provider: { order: [tag], allow_fallbacks: false }, messages, reasoning: { effort: 'low' }, max_tokens: 64 }) })
          const body = await res.json() as Record<string, any>
          samples.push({ status: res.status, servedBy: body.provider ?? null, prompt: body.usage?.prompt_tokens ?? null, cached: body.usage?.prompt_tokens_details?.cached_tokens ?? null, cacheWrite: body.usage?.prompt_tokens_details?.cache_write_tokens ?? null, cost: body.usage?.cost ?? null, error: body.error?.message?.slice(0, 200) ?? null })
          await sleep(1500)
        }
        return { tag, samples }
      }
      const caching: unknown[] = []
      for (let i = 0; i < tags.length; i += 5) { caching.push(...await Promise.all(tags.slice(i, i + 5).map(probeTag))); report.caching = caching; write() }
      report.passed = true; return
    }

    // (c) Do the speed fields populate when the endpoints API is called with a key?
    const endpoints = await (await fetch(`${API}/models/${SLUG}/endpoints`, { headers: auth })).json() as { data: { endpoints: Record<string, unknown>[] } }
    report.endpointsWithKey = endpoints.data.endpoints.map(e => ({ tag: e.tag, provider: e.provider_name, quantization: e.quantization, status: e.status, uptime1d: e.uptime_last_1d, throughput30m: e.throughput_last_30m, latency30m: e.latency_last_30m }))
    write()

    // (d) Does an explicit order pin the endpoint for a tool-bearing request (Auto
    // Exacto applies to those), and which response field names the server?
    const call = async (label: string, model: string, provider: Record<string, unknown> | undefined) => {
      const started = Date.now()
      const res = await fetch(`${API}/chat/completions`, { method: 'POST', headers: auth, body: JSON.stringify({ model, ...(provider ? { provider } : {}), messages: [{ role: 'user', content: 'Reply with the single word OK.' }], tools: [TOOL], tool_choice: 'auto', reasoning: { effort: 'low' }, max_tokens: 400 }) })
      const body = await res.json() as Record<string, any>
      return { label, model, provider, status: res.status, ms: Date.now() - started, servedBy: body.provider ?? null, responseModel: body.model ?? null, id: body.id ?? null, error: body.error ? { code: body.error.code, message: String(body.error.message).slice(0, 300), metadata: body.error.metadata ?? null } : null, usage: body.usage ?? null, topLevelKeys: Object.keys(body).sort() }
    }
    const cases: [string, string, Record<string, unknown> | undefined][] = [
      ['pin deepinfra/fp8', SLUG, { order: ['deepinfra/fp8'], allow_fallbacks: false }],
      ['pin deepinfra/fp8', SLUG, { order: ['deepinfra/fp8'], allow_fallbacks: false }],
      ['pin atlas-cloud/fp8', SLUG, { order: ['atlas-cloud/fp8'], allow_fallbacks: false }],
      ['pin atlas-cloud/fp8', SLUG, { order: ['atlas-cloud/fp8'], allow_fallbacks: false }],
      ['pin morph/fp8', SLUG, { order: ['morph/fp8'], allow_fallbacks: false }],
      ['pin baseten/fast (fp32 service tier)', SLUG, { order: ['baseten/fast'], allow_fallbacks: false }],
      ['base slug baseten + fp8 only', SLUG, { order: ['baseten'], allow_fallbacks: false, quantizations: ['fp8'] }],
      ['three-endpoint order, no fallbacks', SLUG, { order: ['atlas-cloud/fp8', 'deepinfra/fp8', 'morph/fp8'], allow_fallbacks: false, quantizations: ['fp8'], require_parameters: true }],
      ['display name instead of tag', SLUG, { order: ['DeepInfra'], allow_fallbacks: false }],
      ['nitro', `${SLUG}:nitro`, undefined],
      ['nitro + data_collection deny', `${SLUG}:nitro`, { data_collection: 'deny' }],
      ['sort throughput (no suffix)', SLUG, { sort: 'throughput' }]
    ]
    const calls = []
    for (const [label, model, provider] of cases) { calls.push(await call(label, model, provider)); report.calls = calls; write() }

    // Generation stats name the provider too; they settle a moment after the call.
    await sleep(4000)
    const sample = calls.find(c => c.id && c.status === 200)
    if (sample) {
      const gen = await (await fetch(`${API}/generation?id=${encodeURIComponent(sample.id)}`, { headers: auth })).json() as Record<string, any>
      report.generationSample = { label: sample.label, keys: Object.keys(gen.data ?? {}).sort(), provider_name: gen.data?.provider_name ?? null, model: gen.data?.model ?? null, total_cost: gen.data?.total_cost ?? null }
    }
    write()

    // (a, live) End to end through OpenCode: a pass-through proxy records which
    // provider served each streamed request. Headers are forwarded, never stored.
    const served: { model: string | null; provider: unknown; servedBy: string | null; status: number }[] = []
    const proxy = http.createServer((req, res) => {
      const chunks: Buffer[] = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
        const raw = Buffer.concat(chunks); let parsed: Record<string, any> = {}; try { parsed = JSON.parse(raw.toString('utf8')) } catch {}
        const upstream = https.request(`https://openrouter.ai${req.url}`, { method: req.method, headers: { ...req.headers, host: 'openrouter.ai', 'content-length': String(raw.length), 'accept-encoding': 'identity' } }, up => {
          res.writeHead(up.statusCode ?? 502, up.headers)
          let text = ''; up.on('data', c => { text += c.toString('utf8'); res.write(c) })
          up.on('end', () => { res.end(); const m = /"provider"\s*:\s*"([^"]+)"/.exec(text); served.push({ model: parsed.model ?? null, provider: parsed.provider ?? null, servedBy: m ? m[1] : null, status: up.statusCode ?? 0 }) })
        })
        upstream.on('error', () => { res.writeHead(502); res.end() }); upstream.end(raw)
      })
    })
    proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening')
    const port = (proxy.address() as { port: number }).port
    const opencodeRuns = []
    for (const [label, route] of [['opencode pinned deepinfra/fp8', { order: ['deepinfra/fp8'], allow_fallbacks: false }], ['opencode pinned atlas-cloud/fp8', { order: ['atlas-cloud/fp8'], allow_fallbacks: false }]] as const) {
      const root = fs.mkdtempSync(path.join(evidence, 'opencode-')), state = path.join(root, 'state'), data = path.join(root, 'data'), work = path.join(root, 'work')
      for (const dir of [state, data, work]) fs.mkdirSync(dir)
      const request = opencodeHelper.buildExecution({ attemptId: label, cwd: work, kind: 'analysis', brief: 'Reply with the single word OK. Do not use tools.', model: SLUG, installedVersion: '1.18.33', effort: 'low', route: { baseUrl: API }, credential: { envVarName: 'OPENROUTER_API_KEY', value: key }, allowedCommands: [], signal: new AbortController().signal })
      const config = JSON.parse(request.envAdditions!.OPENCODE_CONFIG_CONTENT)
      config.provider.openrouter.options = { baseURL: `http://127.0.0.1:${port}/api/v1` }
      config.provider.openrouter.models[SLUG] = { ...config.provider.openrouter.models[SLUG], options: { provider: route } }
      request.envAdditions!.OPENCODE_CONFIG_CONTENT = JSON.stringify(config)
      const before = served.length
      const child = spawn(request.executable, request.args, { cwd: work, env: { ...composeHelperEnv(process.env, request), XDG_STATE_HOME: state, XDG_DATA_HOME: data }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      let stdout = ''; child.stdout!.on('data', c => { stdout += c })
      child.stdin!.end(request.stdin)
      const timer = setTimeout(() => child.kill(), 180000), [code] = await once(child, 'close'); clearTimeout(timer)
      opencodeRuns.push({ label, route, exitCode: code, replied: /\bOK\b/.test(stdout), requests: served.slice(before) })
      report.opencodeRuns = opencodeRuns; write()
    }
    proxy.closeAllConnections(); proxy.close()
    report.finishedAt = new Date().toISOString(); report.passed = true
  } catch (error) {
    report.passed = false; report.error = error instanceof Error ? error.message : String(error)
  } finally { write(); app.exit(0) }
})
