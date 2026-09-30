import { afterEach, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import { TeamBridgeService } from './teamBridgeService'
import { TeamDomainError } from './teamCore'
const brokers: TeamBridgeService[] = []
afterEach(async () => { await Promise.all(brokers.splice(0).map(b => b.dispose())) })
async function fixture() {
  const dispatch = vi.fn(async (_actor, _name, _args, _signal) => ({ marker: 'ok' }))
  const authorize = vi.fn(), handshake = vi.fn()
  const broker = new TeamBridgeService({ dispatch, authorize, handshake }); brokers.push(broker)
  await broker.start(); const credentials = broker.issue('run', 1, 'epoch')
  const request = async (body: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(credentials.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  }
  return { broker, credentials, request, dispatch, authorize, handshake }
}
describe('authenticated team broker', () => {
  it('binds authority to transport and validates the thirteen tool schemas', async () => {
    const f = await fixture()
    const list = await f.request({ method: 'tools/list' })
    expect(list.body.result.tools).toHaveLength(13); expect(f.handshake).toHaveBeenCalledOnce()
    const status = await f.request({ method: 'tools/call', name: 'team_status', arguments: {} })
    expect(status.body.ok).toBe(true)
    expect(f.dispatch.mock.calls[0][0]).toEqual({ role: 'lead', runId: 'run', generation: 1, epoch: 'epoch' })
    expect((await f.request({ method: 'tools/call', name: 'team_status', arguments: { actor: 'user' } })).status).toBe(400)
    expect(f.dispatch).toHaveBeenCalledOnce()
  })
  it('rejects missing/rotated tokens and browser origins before domain calls', async () => {
    const f = await fixture()
    expect((await f.request({ method: 'tools/list' }, { Authorization: 'Bearer wrong' })).status).toBe(401)
    expect((await f.request({ method: 'tools/list' }, { Origin: 'http://localhost' })).status).toBe(403)
    f.broker.issue('run', 2, 'new-epoch')
    expect((await f.request({ method: 'tools/list' })).status).toBe(401)
    expect(f.authorize).not.toHaveBeenCalled()
  })
  it('keeps permission refusals as explicit domain errors and scrubs token reflection', async () => {
    const f = await fixture()
    f.authorize.mockImplementationOnce(() => { throw new TeamDomainError('INSPECTION_ONLY', 'Run is pausing.') })
    expect((await f.request({ method: 'tools/call', name: 'team_status', arguments: {} })).body).toMatchObject({ ok: false, error: { code: 'INSPECTION_ONLY' } })
    f.dispatch.mockResolvedValueOnce({ marker: f.credentials.token })
    expect(JSON.stringify((await f.request({ method: 'tools/call', name: 'team_status', arguments: {} })).body)).not.toContain(f.credentials.token)
  })
  it('aborts outstanding waits on token revocation without issuing task cancellation', async () => {
    const f = await fixture()
    let signal: AbortSignal | undefined
    f.dispatch.mockImplementationOnce(async (_a, _n, _p, s) => { signal = s; await new Promise<void>(resolve => s.addEventListener('abort', () => resolve(), { once: true })); return { marker: 'aborted' } })
    const pending = f.request({ method: 'tools/call', name: 'team_wait', arguments: { taskIds: [] } }).catch(() => null)
    while (!signal) await new Promise(resolve => setTimeout(resolve, 5))
    f.broker.revoke('run'); await pending
    expect(signal.aborted).toBe(true); expect(f.dispatch).toHaveBeenCalledOnce(); expect(f.dispatch.mock.calls[0][1]).toBe('team_wait')
  })
  it('checks exact Host and input size without parsing unauthorized data', async () => {
    const f = await fixture()
    const status = await new Promise<number>(resolve => {
      const request = http.request(f.credentials.endpoint, { method: 'POST', headers: { Host: 'localhost', Authorization: `Bearer ${f.credentials.token}`, 'Content-Type': 'application/json' } }, response => { response.resume(); resolve(response.statusCode!) })
      request.end('not-json')
    })
    expect(status).toBe(403)
    const oversized = await new Promise<number>(resolve => {
      const request = http.request(f.credentials.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${f.credentials.token}`, 'Content-Type': 'application/json', 'Content-Length': '1048577' } }, response => { response.resume(); resolve(response.statusCode!) })
      request.end()
    })
    expect(oversized).toBe(413)
    expect(f.dispatch).not.toHaveBeenCalled()
  })
})
