'use strict'
// Disposable stdio MCP peer used to verify composition with the Team bridge.
const readline = require('node:readline')
const fs = require('node:fs')
readline.createInterface({ input: process.stdin }).on('line', line => {
  let request
  try { request = JSON.parse(line) } catch { return }
  if (request.id === undefined) return
  let result
  if (request.method === 'initialize') result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'chorus-memory-fixture', version: '1.0.0' } }
  else if (request.method === 'tools/list') result = { tools: [{ name: 'fixture_memory_probe', description: 'Read-only probe of the disposable memory MCP composition fixture.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] }
  else if (request.method === 'tools/call' && request.params.name === 'fixture_memory_probe') {
    const noncePresent = typeof process.env.CHORUS_FIXTURE_NONCE === 'string' && process.env.CHORUS_FIXTURE_NONCE.length >= 32
    fs.writeFileSync(process.env.CHORUS_FIXTURE_EVIDENCE, JSON.stringify({ noncePresent, noNonceInArgs: !process.argv.some(arg => arg.includes(process.env.CHORUS_FIXTURE_NONCE)), at: new Date().toISOString() }))
    result = { content: [{ type: 'text', text: noncePresent ? 'MEMORY_FIXTURE_OK' : 'MEMORY_FIXTURE_ENV_MISSING' }], isError: !noncePresent }
  } else if (request.method === 'ping') result = {}
  else { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Unknown fixture method' } }) + '\n'); return }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n')
})
