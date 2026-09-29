import http from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Socket } from 'node:net'
import { z } from 'zod'
import { TEAM_LIMITS, teamToolSchemas, teamMcpToolDescriptors, type TeamToolName } from '../../shared/team'
import { TeamDomainError, type TeamActor } from './teamCore'
import { scrubSecrets } from './logger'

type LeadActor = Extract<TeamActor, { role: 'lead' }>
interface TokenRecord { actor: LeadActor; token: string; digest: Buffer; active: Set<{ controller: AbortController; response: http.ServerResponse }> }
export interface TeamBridgeDependencies {
  authorize(actor: LeadActor, operation: TeamToolName): void
  dispatch(actor: LeadActor, operation: TeamToolName, args: unknown, signal: AbortSignal): Promise<unknown>
  handshake?(actor: LeadActor): void
}
const envelopeSchema = z.discriminatedUnion('method', [
  z.strictObject({ method: z.literal('tools/list') }),
  z.strictObject({ method: z.literal('tools/call'), name: z.enum(Object.keys(teamToolSchemas) as [TeamToolName, ...TeamToolName[]]), arguments: z.record(z.string(), z.unknown()) })
])
const digest = (token: string) => createHash('sha256').update(token).digest()

/** Private loopback broker. It is separate from Fleet Comms and never accepts actor identity in JSON. */
export class TeamBridgeService {
  private readonly server: http.Server
  private readonly tokens = new Map<string, TokenRecord>()
  private readonly sockets = new Set<Socket>()
  private port: number | null = null
  constructor(private readonly dependencies: TeamBridgeDependencies) {
    this.server = http.createServer({ maxHeaderSize: 16384, headersTimeout: 10000, requestTimeout: 10000, keepAliveTimeout: 1000 }, (request, response) => { void this.handle(request, response) })
    this.server.maxConnections = 64
    this.server.on('connection', socket => {
      this.sockets.add(socket); socket.setTimeout(30000, () => socket.destroy())
      socket.on('close', () => this.sockets.delete(socket))
    })
    this.server.on('upgrade', (_request, socket) => socket.destroy())
    this.server.on('clientError', (_error, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n') })
  }
  async start(): Promise<string> {
    if (this.port !== null) return this.endpoint()
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => reject(error)
      this.server.once('error', failed)
      this.server.listen(0, '127.0.0.1', () => { this.server.off('error', failed); resolve() })
    })
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('Team broker did not bind a loopback port.')
    this.port = address.port
    return this.endpoint()
  }
  private endpoint(): string { return `http://127.0.0.1:${this.port}/team` }
  issue(runId: string, generation: number, epoch: string): { endpoint: string; token: string } {
    if (this.port === null) throw new Error('Team broker is not started.')
    this.revoke(runId)
    const token = randomBytes(32).toString('base64url'), actor = Object.freeze({ role: 'lead' as const, runId, generation, epoch })
    this.tokens.set(runId, { actor, token, digest: digest(token), active: new Set() })
    return { endpoint: this.endpoint(), token }
  }
  revoke(runId: string): void {
    const record = this.tokens.get(runId)
    if (!record) return
    this.tokens.delete(runId)
    for (const active of record.active) { active.controller.abort(); active.response.destroy() }
    record.active.clear()
  }
  async dispose(): Promise<void> {
    for (const runId of this.tokens.keys()) this.revoke(runId)
    for (const socket of this.sockets) socket.destroy()
    if (this.server.listening) await new Promise<void>(resolve => this.server.close(() => resolve()))
    this.port = null
  }
  private findToken(request: http.IncomingMessage): TokenRecord | undefined {
    if (typeof request.headers.authorization !== 'string' || !/^Bearer [A-Za-z0-9_-]{43}$/.test(request.headers.authorization)) return undefined
    const candidate = digest(request.headers.authorization.slice(7))
    return [...this.tokens.values()].find(record => timingSafeEqual(candidate, record.digest))
  }
  private send(response: http.ServerResponse, status: number, value: unknown, token?: string): void {
    if (response.destroyed || response.writableEnded) return
    let body: string
    try { body = scrubSecrets(JSON.stringify(value)); if (token) body = body.split(token).join('[REDACTED]') } catch { body = '{"ok":false,"error":{"code":"INVALID_RESULT","message":"Team result could not be encoded."}}' }
    if (Buffer.byteLength(body) > TEAM_LIMITS.bodyBytes) { status = 413; body = '{"ok":false,"error":{"code":"RESULT_TOO_LARGE","message":"Use a smaller result/event page."}}' }
    response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', Connection: 'close' }); response.end(body)
  }
  private async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const reject = (status: number, code: string) => this.send(response, status, { ok: false, error: { code, message: 'Team broker request refused.' } })
    const headerCount = (name: string) => request.rawHeaders.filter((_value, i) => i % 2 === 0 && request.rawHeaders[i].toLowerCase() === name).length
    if (request.socket.remoteAddress !== '127.0.0.1' || request.method !== 'POST' || request.url !== '/team' || request.headers.host !== `127.0.0.1:${this.port}` || request.headers.origin !== undefined || headerCount('host') !== 1 || headerCount('authorization') !== 1 || request.headers.upgrade !== undefined) { reject(403, 'INVALID_ORIGIN'); return }
    const token = this.findToken(request)
    if (!token) { reject(401, 'UNAUTHORIZED'); return }
    if (token.active.size >= 32) { reject(429, 'TOO_MANY_REQUESTS'); return }
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '') || (request.headers['content-length'] !== undefined && (!/^\d+$/.test(request.headers['content-length']) || Number(request.headers['content-length']) > TEAM_LIMITS.bodyBytes))) { reject(413, 'INVALID_BODY'); return }
    const controller = new AbortController(), active = { controller, response }
    token.active.add(active)
    const deadline = setTimeout(() => { controller.abort(); response.destroy() }, 30000)
    const bodyDeadline = setTimeout(() => { controller.abort(); reject(408, 'BODY_TIMEOUT'); request.destroy() }, 10000)
    response.on('close', () => { if (!response.writableEnded) controller.abort() })
    request.on('aborted', () => controller.abort())
    try {
      let bytes = 0
      const chunks: Buffer[] = []
      for await (const chunk of request) {
        bytes += chunk.length
        if (bytes > TEAM_LIMITS.bodyBytes) { reject(413, 'BODY_TOO_LARGE'); request.destroy(); return }
        chunks.push(Buffer.from(chunk))
      }
      clearTimeout(bodyDeadline)
      if (controller.signal.aborted || this.tokens.get(token.actor.runId) !== token) return
      const body = envelopeSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))))
      const name = body.method === 'tools/list' ? 'team_roster' : body.name
      this.dependencies.authorize(token.actor, name)
      if (body.method === 'tools/list') {
        this.dependencies.handshake?.(token.actor)
        this.send(response, 200, { ok: true, result: { tools: teamMcpToolDescriptors() } }, token.token)
        return
      }
      const args = teamToolSchemas[name].parse(body.arguments)
      const result = await this.dependencies.dispatch(token.actor, name, args, controller.signal)
      if (!controller.signal.aborted && this.tokens.get(token.actor.runId) === token) this.send(response, 200, { ok: true, result }, token.token)
    } catch (error) {
      if (controller.signal.aborted) return
      if (error instanceof TeamDomainError) this.send(response, 200, { ok: false, error: { code: error.code, message: error.message } }, token.token)
      else if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError) reject(400, 'INVALID_REQUEST')
      else this.send(response, 200, { ok: false, error: { code: 'OPERATION_FAILED', message: 'The team operation failed; inspect run state.' } }, token.token)
    } finally { clearTimeout(deadline); clearTimeout(bodyDeadline); token.active.delete(active) }
  }
}
