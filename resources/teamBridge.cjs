'use strict'

// Tools-only MCP stdio facade. Main owns authority, schemas, state and all effects.
// This private HTTP protocol is deliberately not Streamable HTTP MCP.
const http = require('node:http')
const { TextDecoder } = require('node:util')
const VERSION = '2025-06-18'
const MAX_BYTES = 1024 * 1024
const MAX_PENDING = 32
const METHODS = new Set(['tools/list', 'tools/call'])
const TOOL_NAMES = new Set(['team_roster', 'team_delegate', 'team_status', 'team_wait', 'team_review', 'team_revise', 'team_integrate', 'team_cancel'])
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const validId = id => typeof id === 'string' || (typeof id === 'number' && Number.isSafeInteger(id))

function parseEndpoint(value) {
  // Check literal spelling too: URL normalizes alternative IPv4 representations.
  if (typeof value !== 'string' || !/^http:\/\/127\.0\.0\.1:[0-9]+\/team$/.test(value)) throw Error('Invalid local endpoint.')
  const url = new URL(value)
  const port = Number(url.port)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || port < 1024 || port > 65535 || url.username || url.password || url.search || url.hash || url.pathname !== '/team') throw Error('Invalid local endpoint.')
  return url
}

function callBroker(endpoint, token, payload, signal) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload)
    if (Buffer.byteLength(body) > MAX_BYTES) return reject(Error('Request exceeds limit.'))
    // Direct http.request ignores HTTP_PROXY and never follows redirects.
    const request = http.request(endpoint, {
      method: 'POST', agent: false, signal, maxHeaderSize: 16 * 1024,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, response => {
      if (response.statusCode !== 200) { response.destroy(); reject(Error('Broker refused request.')); return }
      let size = 0
      const parts = []
      response.on('data', part => {
        size += part.length
        if (size > MAX_BYTES) { response.destroy(); reject(Error('Broker response exceeds limit.')); return }
        parts.push(part)
      })
      response.on('error', () => reject(Error('Broker response interrupted.')))
      response.on('end', () => {
        try {
          const value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(parts)))
          if (!record(value) || typeof value.ok !== 'boolean') throw Error()
          resolve(value)
        } catch { reject(Error('Invalid broker response.')) }
      })
    })
    const deadline = setTimeout(() => request.destroy(Error('Broker deadline exceeded.')), 30000)
    request.on('close', () => clearTimeout(deadline))
    request.on('error', () => reject(Error('Broker unavailable.')))
    request.end(body)
  })
}

function runFacade(io = process) {
  let endpoint
  const token = io.env.CHORUS_TEAM_TOKEN
  try {
    endpoint = parseEndpoint(io.env.CHORUS_TEAM_ENDPOINT)
    if (typeof token !== 'string' || token.length < 32 || token.length > 512 || !/^[A-Za-z0-9_-]+$/.test(token)) throw Error()
  } catch {
    io.stderr.write('Team bridge configuration is unavailable.\n')
    io.exitCode = 2
    return
  }
  let initialized = false
  let ready = false
  let closed = false
  let buffer = Buffer.alloc(0)
  let tools = null
  let blocked = false
  const output = []
  const pending = new Map()
  const key = id => `${typeof id}:${id}`
  const stop = () => {
    if (closed) return
    closed = true
    buffer = Buffer.alloc(0)
    for (const entry of pending.values()) entry.controller.abort()
    pending.clear()
    io.stdin.pause()
    io.stdin.destroy()
  }
  const drain = () => {
    blocked = false
    while (output.length) {
      if (!io.stdout.write(output.shift())) { blocked = true; break }
    }
    if (!blocked && !closed) io.stdin.resume()
  }
  io.stdout.on('drain', drain)
  io.stdout.on('error', stop)
  const send = value => {
    if (closed) return
    let line = JSON.stringify(value) + '\n'
    if (Buffer.byteLength(line) > MAX_BYTES) line = JSON.stringify({ jsonrpc: '2.0', id: value.id ?? null, error: { code: -32603, message: 'Response exceeds limit.' } }) + '\n'
    if (output.length >= MAX_PENDING) { io.exitCode = 1; stop(); return }
    output.push(line)
    if (!blocked) drain()
    if (blocked) io.stdin.pause()
  }
  const error = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })
  const reply = (id, result) => send({ jsonrpc: '2.0', id, result })
  const loadTools = signal => {
    // Authenticate even cached-schema reads so revoked generations fail closed.
    return callBroker(endpoint, token, { method: 'tools/list' }, signal).then(value => {
      if (!value.ok || !record(value.result) || !Array.isArray(value.result.tools) || value.result.tools.length !== 8) throw Error('Invalid tool schemas.')
      const names = new Set()
      for (const tool of value.result.tools) {
        if (!record(tool) || !TOOL_NAMES.has(tool.name) || !record(tool.inputSchema) || names.has(tool.name)) throw Error('Invalid tool schemas.')
        names.add(tool.name)
      }
      if (JSON.stringify(value.result).includes(token)) throw Error('Invalid tool schemas.')
      if (tools && JSON.stringify(tools) !== JSON.stringify(value.result)) throw Error('Tool schemas changed within a run.')
      tools = value.result
      return tools
    })
  }
  const handle = async message => {
    if (!record(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' || ('id' in message && !validId(message.id))) {
      error(null, -32600, 'Invalid request.')
      return
    }
    const { id, method, params } = message
    if (id === undefined) {
      if (method === 'notifications/initialized' && initialized) ready = true
      if (method === 'notifications/cancelled' && record(params) && validId(params.requestId)) {
        const entry = pending.get(key(params.requestId))
        if (entry?.wait) entry.controller.abort()
      }
      return
    }
    if (pending.has(key(id))) { error(id, -32600, 'Duplicate pending request ID.'); return }
    if (method === 'initialize') {
      if (initialized || !record(params) || typeof params.protocolVersion !== 'string' || !record(params.capabilities) || !record(params.clientInfo) || typeof params.clientInfo.name !== 'string' || typeof params.clientInfo.version !== 'string') {
        error(id, -32602, 'Invalid initialization.'); return
      }
      initialized = true
      reply(id, { protocolVersion: VERSION, capabilities: { tools: {} }, serverInfo: { name: 'chorus-team', version: '1.0.0' } })
      return
    }
    if (method === 'ping') { reply(id, {}); return }
    if (!ready) { error(id, -32002, 'Bridge is not initialized.'); return }
    if (!METHODS.has(method)) { error(id, -32601, 'Method not supported.'); return }
    if ((method === 'tools/list' && params !== undefined && (!record(params) || Object.keys(params).some(k => k !== '_meta'))) ||
        (method === 'tools/call' && (!record(params) || typeof params.name !== 'string' || (params.arguments !== undefined && !record(params.arguments)) || Object.keys(params).some(k => !['name', 'arguments', '_meta'].includes(k))))) {
      error(id, -32602, 'Invalid parameters.'); return
    }
    if (pending.size >= MAX_PENDING) { error(id, -32000, 'Too many pending requests.'); return }
    const controller = new AbortController()
    const entry = { controller, wait: method === 'tools/call' && params.name === 'team_wait' }
    pending.set(key(id), entry)
    try {
      const list = await loadTools(controller.signal)
      if (controller.signal.aborted || closed) return
      if (method === 'tools/list') { reply(id, list); return }
      if (!list.tools.some(tool => tool.name === params.name)) { error(id, -32602, 'Unknown tool.'); return }
      const value = await callBroker(endpoint, token, { method: 'tools/call', name: params.name, arguments: params.arguments ?? {} }, controller.signal)
      if (controller.signal.aborted || closed) return
      if (value.ok && !Object.hasOwn(value, 'result')) throw Error('Missing broker result.')
      // Domain refusal stays an MCP tool error. Broker diagnostics never carry the token.
      const text = JSON.stringify(value.ok ? value.result : { error: value.error ?? { code: 'REFUSED', message: 'Team operation refused.' } })
      reply(id, { content: [{ type: 'text', text: typeof text === 'string' ? text.split(token).join('[REDACTED]') : '{}' }], isError: !value.ok })
    } catch {
      if (!controller.signal.aborted && !closed) {
        if (method === 'tools/call') reply(id, { content: [{ type: 'text', text: 'Team broker unavailable or response invalid.' }], isError: true })
        else error(id, -32603, 'Team broker unavailable or response invalid.')
      }
    } finally {
      if (pending.get(key(id)) === entry) pending.delete(key(id))
    }
  }
  io.stdin.on('data', chunk => {
    if (closed) return
    buffer = Buffer.concat([buffer, Buffer.from(chunk)])
    for (;;) {
      const end = buffer.indexOf(10)
      if (end < 0) break
      const line = buffer.subarray(0, end)
      buffer = buffer.subarray(end + 1)
      if (line.length > MAX_BYTES) { error(null, -32600, 'Frame exceeds limit.'); stop(); return }
      if (!line.length) continue
      try { void handle(JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(line))) }
      catch { error(null, -32700, 'Invalid JSON.'); }
      if (closed) return
    }
    if (buffer.length > MAX_BYTES) { error(null, -32600, 'Frame exceeds limit.'); stop() }
  })
  io.stdin.on('end', stop)
  io.stdin.on('error', stop)
  return { stop }
}

module.exports = { parseEndpoint, callBroker, runFacade, MAX_BYTES, MAX_PENDING, VERSION }
if (require.main === module) runFacade()
