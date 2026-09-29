import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import readline from 'node:readline'
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bridge = path.join(root, 'resources/teamBridge.cjs')
const { parseEndpoint, MAX_BYTES } = require(bridge)
const names = ['team_roster', 'team_delegate', 'team_status', 'team_wait', 'team_review', 'team_revise', 'team_integrate', 'team_cancel']
const readOnly = new Set(['team_roster', 'team_status', 'team_wait'])
const schemas = names.map(name => ({ name, description: `Compatibility fixture: ${name}`, inputSchema: {
  type: 'object', properties: {
    clientRequestId: { type: 'string' }, memberId: { type: 'string' }, kind: { type: 'string', enum: ['code', 'analysis'] },
    title: { type: 'string' }, brief: { type: 'string' }, taskId: { type: 'string' }, taskIds: { type: 'array', items: { type: 'string' } },
    timeoutMs: { type: 'integer' }, reason: { type: 'string' }
  }, additionalProperties: false
}, annotations: { readOnlyHint: readOnly.has(name), destructiveHint: !readOnly.has(name), openWorldHint: false } }))
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const option = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1] }
const evidence = path.resolve(option('--evidence') ?? fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-team-compat-')))
fs.mkdirSync(evidence, { recursive: true })

function makeClient(endpoint, token) {
  const child = spawn(process.execPath, [bridge], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: {
    ...process.env, CHORUS_TEAM_ENDPOINT: endpoint, CHORUS_TEAM_TOKEN: token
  } })
  const inbox = []
  let stderr = ''
  readline.createInterface({ input: child.stdout }).on('line', line => inbox.push(JSON.parse(line)))
  child.stderr.on('data', data => { stderr += data })
  const exited = once(child, 'close')
  let next = 1
  const send = message => child.stdin.write(JSON.stringify(message) + '\n')
  const receive = async (id, timeout = 5000) => {
    const until = Date.now() + timeout
    while (Date.now() < until) {
      const at = inbox.findIndex(message => message.id === id)
      if (at !== -1) return inbox.splice(at, 1)[0]
      await delay(10)
    }
    throw Error(`No response for fixture request ${id}.`)
  }
  return { child, inbox, send, receive, exited, stderr: () => stderr,
    async request(method, params) { const id = next++; send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }); return receive(id) },
    async initialize() {
      const result = await this.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } })
      assert.equal(result.result.protocolVersion, '2025-06-18')
      assert.deepEqual(result.result.capabilities, { tools: {} })
      send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    },
    async close() {
      child.stdin.end()
      let timer
      try { await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => { child.kill(); reject(Error('Bridge did not exit on EOF.')) }, 3000) })]) }
      finally { clearTimeout(timer) }
    }
  }
}

async function fixture() {
  let assertions = 0
  const check = fn => { fn(); assertions++ }
  for (const value of ['https://127.0.0.1:1234/team', 'http://localhost:1234/team', 'http://127.1:1234/team', 'http://2130706433:1234/team', 'http://127.0.0.1:80/team', 'http://127.0.0.1:1234/team?token=x', 'http://127.0.0.1:1234@evil.example/team', 'http://127.0.0.1:1234/other']) check(() => assert.throws(() => parseEndpoint(value)))
  const token = crypto.randomBytes(32).toString('base64url')
  let revoked = false
  let mode = 'normal'
  let cancelledWaits = 0
  let cancelledTasks = 0
  let calls = 0
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}` || revoked) { res.writeHead(401).end(); return }
    let text = ''
    req.on('data', chunk => { text += chunk })
    req.on('end', () => {
      const data = JSON.parse(text)
      calls++
      const reply = value => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value))
      if (mode === 'redirect') { res.writeHead(302, { Location: 'http://127.0.0.1:1/secret' }).end(); return }
      if (mode === 'malformed') { res.writeHead(200).end('not json'); return }
      if (mode === 'oversized') { res.writeHead(200).end('x'.repeat(MAX_BYTES + 1)); return }
      if (mode === 'schema-change') { reply({ ok: true, result: { tools: schemas.map((s, i) => i === 0 ? { ...s, description: 'Changed' } : s) } }); return }
      if (data.method === 'tools/list') { reply({ ok: true, result: { tools: schemas } }); return }
      if (mode === 'large-result') { reply({ ok: true, result: { text: 'x'.repeat(400000) } }); return }
      if (data.name === 'team_wait') {
        const timer = setTimeout(() => reply({ ok: true, result: { state: 'running' } }), 1000)
        res.on('close', () => { clearTimeout(timer); if (!res.writableEnded) cancelledWaits++ })
        return
      }
      if (data.name === 'team_cancel') cancelledTasks++
      if (data.name === 'team_delegate') { reply({ ok: false, error: { code: 'FIXTURE_REFUSAL', message: 'Expected domain refusal.' } }); return }
      reply({ ok: true, result: { marker: 'fixture 🟢', echo: data.arguments } })
    })
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const endpoint = `http://127.0.0.1:${server.address().port}/team`
  const client = makeClient(endpoint, token)
  try {
    check(() => assert.equal(parseEndpoint(endpoint).hostname, '127.0.0.1'))
    check(() => assert.equal(calls, 0))
    const before = await client.request('tools/list'); check(() => assert.equal(before.error.code, -32002))
    await client.initialize(); assertions += 2
    const list = await client.request('tools/list'); check(() => assert.equal(list.result.tools.length, 8))
    const ping = await client.request('ping'); check(() => assert.deepEqual(ping.result, {}))
    const unsupported = await client.request('resources/list'); check(() => assert.equal(unsupported.error.code, -32601))
    const invalid = await client.request('tools/call', { name: 'team_status', arguments: [] }); check(() => assert.equal(invalid.error.code, -32602))
    const unknown = await client.request('tools/call', { name: 'not_a_team_tool' }); check(() => assert.equal(unknown.error.code, -32602))
    const reinitialize = await client.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } }); check(() => assert.equal(reinitialize.error.code, -32602))
    client.child.stdin.write('broken\n'); const broken = await client.receive(null); check(() => assert.equal(broken.error.code, -32700))
    client.child.stdin.write(Buffer.from([0xc3, 0x28, 10])); const invalidUtf8 = await client.receive(null); check(() => assert.equal(invalidUtf8.error.code, -32700))
    const fragmented = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 900, method: 'tools/call', params: { name: 'team_status', arguments: { text: 'split 🟢\nline' } } }) + '\n')
    for (let offset = 0; offset < fragmented.length; offset += 3) client.child.stdin.write(fragmented.subarray(offset, offset + 3))
    const split = await client.receive(900); check(() => assert.equal(JSON.parse(split.result.content[0].text).echo.text, 'split 🟢\nline'))
    const refusal = await client.request('tools/call', { name: 'team_delegate', arguments: {} }); check(() => assert.equal(refusal.result.isError, true))
    client.send({ jsonrpc: '2.0', id: 901, method: 'tools/call', params: { name: 'team_wait', arguments: {} } })
    await delay(80)
    client.send({ jsonrpc: '2.0', id: 901, method: 'tools/call', params: { name: 'team_wait', arguments: {} } })
    const duplicate = await client.receive(901); check(() => assert.equal(duplicate.error.code, -32600))
    client.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 901 } })
    await delay(80)
    check(() => assert.equal(cancelledWaits, 1)); check(() => assert.equal(cancelledTasks, 0))
    revoked = true
    const revokedList = await client.request('tools/list'); check(() => assert.equal(revokedList.error.code, -32603))
    revoked = false; mode = 'redirect'
    const redirect = await client.request('tools/list'); check(() => assert.equal(redirect.error.code, -32603))
    mode = 'malformed'
    const malformed = await client.request('tools/list'); check(() => assert.equal(malformed.error.code, -32603))
    mode = 'oversized'
    const oversizedResponse = await client.request('tools/list'); check(() => assert.equal(oversizedResponse.error.code, -32603))
    mode = 'schema-change'
    const schemaChange = await client.request('tools/list'); check(() => assert.equal(schemaChange.error.code, -32603))
    mode = 'normal'
    for (let i = 0; i < 33; i++) client.send({ jsonrpc: '2.0', id: 2000 + i, method: 'tools/call', params: { name: 'team_wait', arguments: {} } })
    const pendingLimit = await client.receive(2032); check(() => assert.equal(pendingLimit.error.code, -32000))
    for (let i = 0; i < 32; i++) await client.receive(2000 + i)
    check(() => assert.equal(cancelledTasks, 0))
    mode = 'large-result'
    client.child.stdout.pause()
    for (let i = 0; i < 16; i++) client.send({ jsonrpc: '2.0', id: 3000 + i, method: 'tools/call', params: { name: 'team_status', arguments: {} } })
    await delay(150)
    check(() => assert.equal(client.child.exitCode, null))
    client.child.stdout.resume()
    for (let i = 0; i < 16; i++) { const result = await client.receive(3000 + i); check(() => assert.equal(JSON.parse(result.result.content[0].text).text.length, 400000)) }
    mode = 'normal'
    client.child.stdin.write(Buffer.alloc(MAX_BYTES + 1, 65))
    await client.exited
    check(() => assert.equal(client.stderr(), ''))
    check(() => assert.ok(!JSON.stringify(client.inbox).includes(token)))
    const eof = makeClient(endpoint, token); await eof.initialize()
    eof.send({ jsonrpc: '2.0', id: 1000, method: 'tools/call', params: { name: 'team_wait', arguments: {} } })
    await delay(80); await eof.close(); await delay(30)
    check(() => assert.equal(cancelledWaits, 2)); check(() => assert.equal(cancelledTasks, 0))
    const rejected = makeClient('http://example.com:1234/team', token)
    const [code] = await rejected.exited; check(() => assert.equal(code, 2))
    check(() => assert.ok(!rejected.stderr().includes(token)))
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    const unavailable = makeClient(endpoint, token); await unavailable.initialize()
    const noBroker = await unavailable.request('tools/list'); check(() => assert.equal(noBroker.error.code, -32603))
    await unavailable.close()
    const report = { mode: 'fixture', passed: true, assertions, node: process.version, at: new Date().toISOString() }
    fs.writeFileSync(path.join(evidence, 'fixture-report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ ...report, evidence }))
  } finally { client.child.kill(); server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve)) }
}

async function live() {
  const { runLive } = await import('./verify-team-live.mjs')
  await runLive({ root, evidence, bridge, names, schemas, option })
}

try {
  if (process.argv.includes('--fixture')) await fixture()
  else if (process.argv.includes('--live')) await live()
  else throw Error('Choose --fixture or --live, with optional --evidence <directory>.')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
