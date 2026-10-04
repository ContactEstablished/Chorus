import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown, input: unknown) => Promise<unknown>
interface FakeWindow {
  isDestroyed: () => boolean
  webContents: { send: ReturnType<typeof vi.fn> }
}
const handlers = vi.hoisted(() => new Map<string, Handler>())
const windowLookup = vi.hoisted(() => vi.fn((_sender: unknown): { isDestroyed: () => boolean } | null => ({ isDestroyed: () => false })))
const windows = vi.hoisted(() => ({ list: [] as FakeWindow[] }))
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, handler: Handler) => handlers.set(name, handler) },
  BrowserWindow: { fromWebContents: windowLookup, getAllWindows: () => windows.list }
}))

import {
  DEFAULT_ROUTING_SETTINGS,
  ROUTING_CHANNELS,
  type ModelRegistryEntry,
  type RoutingObservationSettings,
  type RoutingProgressEvent,
  type RoutingRefreshResult,
  type RoutingSettings,
  type RoutingStatus,
  type TierResult
} from '../../shared/routing'
import { extractObservations, parseEndpointsResponse } from '../routing/endpointsCore'
import { bundledModelRegistry, findModel } from '../routing/registryCore'
import { computeTiers } from '../routing/routingCore'
import { registerRoutingIpc, type RoutingIpcDeps } from './routingIpc'
import type { RoutingObserver } from './routingObserver'
// RoutingError is needed at runtime: the handler's `instanceof` must see the real class (I5).
// routingService.ts imports storage.ts and vault.ts as types only, so it loads under plain vitest.
import { RoutingError, type RoutingService } from './routingService'

/**
 * Model Routing Task 2-4, Table I (ImplementationSpec-2-4): the routing IPC
 * envelope over fake services and a mocked `electron` (the teamIpc.test.ts
 * pattern). No network, no storage, no Electron.
 */

/** Assembled by concatenation so this file never holds a complete key shape (npm run grep:secrets). */
const FAKE_KEY = 'sk-or-v1-' + '0123456789abcdef'.repeat(4)

const SLUG = 'deepseek/deepseek-v4.1-flash'
const C = '5f0c1a2e-8a3b-4c5d-9e6f-0123456789ab'
const REFRESH_ID = '11111111-1111-4111-8111-111111111111'
const AT = '2026-10-02T09:20:00Z'
const frame = {}
const event = { sender: { id: 12, mainFrame: frame }, senderFrame: frame }

// ── The golden TierResult: the Phase 1 golden input (routingCore.test.ts), through the pure core ──
const fixture = JSON.parse(readFileSync(join(__dirname, '../routing/__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json'), 'utf8')) as {
  fetchedAt: string
  guardrailRemoved: string[]
  dataPolicyDenyRemoved: string[]
  cacheVerified: Record<string, boolean>
}
const MODEL = findModel(bundledModelRegistry(), SLUG) as ModelRegistryEntry
const snapshot = { fetchedAt: fixture.fetchedAt, endpoints: parseEndpointsResponse(fixture).endpoints }
const CHECKED_AT = '2026-10-02T09:15:39Z'
function golden(): TierResult {
  return computeTiers({
    model: MODEL,
    snapshot,
    history: extractObservations(snapshot),
    account: { guardrailRemoved: fixture.guardrailRemoved, dataPolicyRemoved: fixture.dataPolicyDenyRemoved, checkedAt: CHECKED_AT },
    cache: Object.fromEntries(Object.entries(fixture.cacheVerified).map(([tag, verified]) => [tag, { verified, checkedAt: CHECKED_AT }])),
    profile: 'interactive',
    effort: 'low',
    settings: DEFAULT_ROUTING_SETTINGS,
    now: AT
  })
}

const MODELS = { models: [{ slug: SLUG, displayName: 'DeepSeek V4.1 Flash' }] }
const SETTINGS: RoutingSettings = { ...DEFAULT_ROUTING_SETTINGS, minUptimePct: 99.4 }
const OBSERVATION: RoutingObservationSettings = { enabled: true, credentialProfileId: C }
const STATUS: RoutingStatus = {
  observer: { state: 'dormant', dormantReason: 'undesignated', nextTickAt: AT, lastTickAt: null, lastOutcome: null, lastFailure: null },
  models: [{ model: SLUG, displayName: 'DeepSeek V4.1 Flash', snapshotFetchedAt: null, observations: 0, cacheVerified: 0, busy: false }],
  requestsSinceStart: 0
}
const refreshResult = (): RoutingRefreshResult => ({
  refreshId: REFRESH_ID,
  estimateUsd: 0.012,
  spentUsd: 0.004,
  probed: ['deepinfra/fp8'],
  notProbed: [{ tag: 'morph/fp8', reason: 'cap' }],
  result: golden()
})

/** One valid input per request channel. */
const VALID: Record<string, unknown> = {
  'routing:models': {},
  'routing:tiers': { model: SLUG, profile: 'interactive', effort: 'low', credentialProfileId: null },
  'routing:refresh': { model: SLUG, credentialProfileId: C, profile: 'interactive', effort: 'low' },
  'routing:status': {},
  'routing:settings-get': {},
  'routing:settings-set': { settings: DEFAULT_ROUTING_SETTINGS },
  'routing:observation-get': {},
  'routing:observation-set': { enabled: true, credentialProfileId: C },
  'routing:credentials': {},
  'routing:launch-preferences': {}
}
/** A field of the wrong type (an array where the empty request wants an object). */
const WRONG_TYPE: Record<string, unknown> = {
  'routing:models': [],
  'routing:tiers': { model: SLUG, profile: 'interactive', effort: 5, credentialProfileId: null },
  'routing:refresh': { model: SLUG, credentialProfileId: 7, profile: 'interactive', effort: 'low' },
  'routing:status': [],
  'routing:settings-get': [],
  'routing:settings-set': { settings: { ...DEFAULT_ROUTING_SETTINGS, minUptimePct: '99.5' } },
  'routing:observation-get': [],
  'routing:observation-set': { enabled: 'yes', credentialProfileId: null },
  'routing:credentials': [],
  'routing:launch-preferences': []
}
const REQUEST_CHANNELS = Object.values(ROUTING_CHANNELS).filter((c) => c !== ROUTING_CHANNELS.progress)

function setup(options: { injectLog?: boolean } = {}) {
  let listener: ((event: RoutingProgressEvent) => void) | null = null
  const service = {
    models: vi.fn(() => structuredClone(MODELS)),
    tiers: vi.fn(() => golden()),
    refresh: vi.fn(async () => refreshResult()),
    getSettings: vi.fn(() => structuredClone(SETTINGS)),
    setSettings: vi.fn(() => structuredClone(SETTINGS)),
    getObservation: vi.fn(() => ({ ...OBSERVATION })),
    setObservation: vi.fn(() => ({ ...OBSERVATION })),
    credentials: vi.fn(() => ({ credentials: [{ id: C, label: 'OR key', providerName: 'OpenRouter' }] })),
    launchPreferences: vi.fn((): unknown => ({ lastChoiceByModel: { [SLUG]: 'balanced' } })),
    onProgress: vi.fn((l: (event: RoutingProgressEvent) => void) => {
      listener = l
      return () => undefined
    })
  }
  const observer = { status: vi.fn(() => structuredClone(STATUS)) }
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  registerRoutingIpc({
    service: service as unknown as Pick<RoutingService, keyof RoutingIpcDeps['service']>,
    observer: observer as unknown as Pick<RoutingObserver, 'status'>,
    // injectLog: false exercises the real default (the pino logger and its err serializer).
    ...(options.injectLog === false ? {} : { log })
  })
  /** The action each channel calls, so one loop can make any of them throw or return. */
  const actions: Record<string, ReturnType<typeof vi.fn>> = {
    'routing:models': service.models,
    'routing:tiers': service.tiers,
    'routing:refresh': service.refresh,
    'routing:status': observer.status,
    'routing:settings-get': service.getSettings,
    'routing:settings-set': service.setSettings,
    'routing:observation-get': service.getObservation,
    'routing:observation-set': service.setObservation,
    'routing:credentials': service.credentials,
    'routing:launch-preferences': service.launchPreferences
  }
  const noActionCalled = (): void => {
    for (const [channel, action] of Object.entries(actions)) expect(action, channel).not.toHaveBeenCalled()
  }
  return { service, observer, log, actions, noActionCalled, progress: () => listener }
}

const call = (channel: string, input: unknown, ev: unknown = event): Promise<unknown> => {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`no handler for ${channel}`)
  return handler(ev, input)
}

beforeEach(() => {
  handlers.clear()
  windowLookup.mockReset()
  windowLookup.mockReturnValue({ isDestroyed: () => false })
  windows.list = [
    { isDestroyed: () => false, webContents: { send: vi.fn() } },
    { isDestroyed: () => true, webContents: { send: vi.fn() } }
  ]
})

describe('Table I — routing IPC', () => {
  it('I1: registers exactly the ten request channels (not routing:progress) and subscribes to progress once', () => {
    const { service } = setup()
    // eight → nine: the Task 3-1 amendment (routing:credentials); nine → ten: Task 4a-1 (routing:launch-preferences)
    expect(REQUEST_CHANNELS).toHaveLength(10)
    expect([...handlers.keys()].sort()).toEqual([...REQUEST_CHANNELS].sort())
    expect(handlers.has(ROUTING_CHANNELS.progress)).toBe(false)
    expect(service.onProgress).toHaveBeenCalledTimes(1)
  })

  it('I2: a subframe, a destroyed window and no window are UNAUTHORIZED on every channel; nothing is called', async () => {
    const { noActionCalled } = setup()
    const refused = { ok: false, code: 'UNAUTHORIZED', message: 'Routing actions require an application window.' }
    for (const channel of REQUEST_CHANNELS) {
      expect(await call(channel, VALID[channel], { ...event, senderFrame: {} }), `${channel} subframe`).toEqual(refused)
      windowLookup.mockReturnValueOnce({ isDestroyed: () => true })
      expect(await call(channel, VALID[channel]), `${channel} destroyed`).toEqual(refused)
      windowLookup.mockReturnValueOnce(null)
      expect(await call(channel, VALID[channel]), `${channel} null`).toEqual(refused)
      // An INVALID input from a refused sender is still UNAUTHORIZED: the sender check precedes parsing.
      const invalid = { ...(VALID[channel] as Record<string, unknown>), extra: 1 }
      expect(await call(channel, invalid, { ...event, senderFrame: {} }), `${channel} invalid subframe`).toEqual(refused)
      windowLookup.mockReturnValueOnce({ isDestroyed: () => true })
      expect(await call(channel, invalid), `${channel} invalid destroyed`).toEqual(refused)
      expect(await call(channel, 'text', { ...event, senderFrame: {} }), `${channel} non-object subframe`).toEqual(refused)
    }
    noActionCalled()
    // The lookup was given the sender, as teamIpc does.
    expect(windowLookup).toHaveBeenCalledWith(event.sender)
  })

  it('I3: an extra key, a wrong type or a non-object is INVALID_REQUEST on every channel; nothing is called', async () => {
    const { noActionCalled } = setup()
    const invalid = { ok: false, code: 'INVALID_REQUEST', message: 'Invalid routing request.' }
    for (const channel of REQUEST_CHANNELS) {
      const valid = VALID[channel] as Record<string, unknown>
      for (const [label, input] of [
        ['extra key', { ...valid, extra: 1 }],
        ['wrong type', WRONG_TYPE[channel]],
        ['string', 'text'],
        ['number', 42],
        ['null', null],
        ['undefined', undefined]
      ] as const) {
        expect(await call(channel, input), `${channel} ${label}`).toEqual(invalid)
      }
    }
    noActionCalled()
  })

  /** I4's responses, kept for I10. */
  async function happyPaths() {
    const ctx = setup()
    const { service, observer } = ctx
    const responses: { channel: string; response: unknown; returned: unknown }[] = []
    const run = async (channel: string, input: unknown, action: ReturnType<typeof vi.fn>) => {
      const response = await call(channel, input)
      const returned = await action.mock.results[action.mock.results.length - 1].value
      responses.push({ channel, response, returned })
      return { response, returned }
    }
    await run('routing:models', {}, service.models)
    await run('routing:tiers', VALID['routing:tiers'], service.tiers)
    await run('routing:refresh', VALID['routing:refresh'], service.refresh)
    await run('routing:status', {}, observer.status)
    await run('routing:settings-get', {}, service.getSettings)
    await run('routing:settings-set', VALID['routing:settings-set'], service.setSettings)
    await run('routing:observation-get', {}, service.getObservation)
    await run('routing:observation-set', VALID['routing:observation-set'], service.setObservation)
    await run('routing:credentials', {}, service.credentials)
    await run('routing:launch-preferences', {}, service.launchPreferences)
    return { ...ctx, responses }
  }

  it('I4: happy paths return { ok: true, value } equal to what the fake returned; each action got exactly the parsed input', async () => {
    const { service, observer, responses, log } = await happyPaths()
    expect(responses).toHaveLength(10) // eight → nine: Task 3-1 (routing:credentials); nine → ten: Task 4a-1 (routing:launch-preferences)
    for (const { channel, response, returned } of responses) {
      expect(response, channel).toStrictEqual({ ok: true, value: returned })
    }
    // The golden result really went through (not an empty object that happened to validate).
    const tiers = responses.find((r) => r.channel === 'routing:tiers')?.response as { value: TierResult }
    expect(tiers.value.candidates).toHaveLength(32)
    expect(tiers.value.tiers.balanced?.endpoints).toEqual(['deepinfra/fp8', 'streamlake/fp8', 'makora/fp8'])
    // Inputs: the empty-request actions take nothing; the others take the parsed request; settings-set unwraps.
    expect(service.models).toHaveBeenCalledWith()
    expect(service.tiers).toHaveBeenCalledWith(VALID['routing:tiers'])
    expect(service.refresh).toHaveBeenCalledWith(VALID['routing:refresh'])
    expect(observer.status).toHaveBeenCalledWith()
    expect(service.getSettings).toHaveBeenCalledWith()
    expect(service.setSettings).toHaveBeenCalledWith(DEFAULT_ROUTING_SETTINGS)
    expect(service.getObservation).toHaveBeenCalledWith()
    expect(service.setObservation).toHaveBeenCalledWith(VALID['routing:observation-set'])
    expect(service.credentials).toHaveBeenCalledWith()
    expect(service.launchPreferences).toHaveBeenCalledWith()
    for (const action of [service.models, service.tiers, service.refresh, observer.status, service.getSettings, service.setSettings, service.getObservation, service.setObservation, service.credentials, service.launchPreferences]) {
      expect(action).toHaveBeenCalledTimes(1)
    }
    expect(log.warn).not.toHaveBeenCalled()
    expect(log.error).not.toHaveBeenCalled()
  })

  it('I5: a RoutingError keeps its code and its message is scrubbed, on every channel', async () => {
    const { actions } = setup()
    for (const channel of REQUEST_CHANNELS) {
      const action = actions[channel]
      action.mockImplementationOnce(() => {
        throw new RoutingError('CREDENTIAL_REFUSED', 'x ' + FAKE_KEY)
      })
      const response = await call(channel, VALID[channel])
      expect(response, channel).toEqual({ ok: false, code: 'CREDENTIAL_REFUSED', message: 'x [redacted]' })
      expect(JSON.stringify(response)).not.toContain(FAKE_KEY)
    }
    // An async rejection is handled the same way as a synchronous throw.
    actions['routing:refresh'].mockImplementationOnce(async () => {
      throw new RoutingError('BUSY', 'busy ' + FAKE_KEY)
    })
    expect(await call('routing:refresh', VALID['routing:refresh'])).toEqual({ ok: false, code: 'BUSY', message: 'busy [redacted]' })
  })

  it('I6: any other error is the fixed OPERATION_FAILED; neither its text nor the key reaches the response', async () => {
    const { actions, log } = setup()
    for (const channel of REQUEST_CHANNELS) {
      const error = new Error('boom ' + FAKE_KEY)
      actions[channel].mockImplementationOnce(() => {
        throw error
      })
      const response = await call(channel, VALID[channel])
      expect(response, channel).toEqual({ ok: false, code: 'OPERATION_FAILED', message: 'Routing operation failed.' })
      const text = JSON.stringify(response)
      expect(text).not.toContain('boom')
      expect(text).not.toContain(FAKE_KEY)
      // Logged once, through the routing log (whose default scrubs through pino's { err } serializer).
      expect(log.error).toHaveBeenLastCalledWith(`${channel} failed`, error)
    }
    expect(log.error).toHaveBeenCalledTimes(REQUEST_CHANNELS.length)
  })

  it('I6 (review): a non-Error throwable is still the fixed OPERATION_FAILED, even when log.error itself throws', async () => {
    const failed = { ok: false, code: 'OPERATION_FAILED', message: 'Routing operation failed.' }
    const { actions, log } = setup()
    log.error.mockImplementation(() => {
      throw new TypeError('serializer failed')
    })
    for (const channel of REQUEST_CHANNELS) {
      actions[channel].mockImplementationOnce(() => {
        throw 'a string ' + FAKE_KEY
      })
      const thrown = await call(channel, VALID[channel])
      expect(thrown, `${channel} string`).toEqual(failed)
      expect(JSON.stringify(thrown)).not.toContain(FAKE_KEY)
      actions[channel].mockImplementationOnce(() => Promise.reject(null))
      expect(await call(channel, VALID[channel]), `${channel} null`).toEqual(failed)
    }
    expect(log.error).toHaveBeenCalledTimes(REQUEST_CHANNELS.length * 2)

    // The real default log (pino, whose err serializer cannot handle a string or null) gives the same reply.
    handlers.clear()
    const real = setup({ injectLog: false })
    real.service.refresh.mockImplementationOnce(async () => {
      throw 'a string'
    })
    expect(await call('routing:refresh', VALID['routing:refresh'])).toEqual(failed)
    real.service.models.mockImplementationOnce(() => {
      throw null
    })
    expect(await call('routing:models', {})).toEqual(failed)
  })

  it('I7: an invalid service output is OPERATION_FAILED; the warning names the channel and an issue count, not the payload', async () => {
    const { service, log } = setup()
    service.tiers.mockImplementationOnce(() => ({ ...golden(), extra: 1 }))
    const response = await call('routing:tiers', VALID['routing:tiers'])
    expect(response).toEqual({ ok: false, code: 'OPERATION_FAILED', message: 'Routing operation failed.' })
    expect(log.warn).toHaveBeenCalledTimes(1)
    const [message] = log.warn.mock.calls[0] as [string]
    expect(message).toBe('routing:tiers produced an invalid response (1 issues)')
    expect(log.warn.mock.calls[0]).toHaveLength(1)
    expect(log.error).not.toHaveBeenCalled()
  })

  it('I8: a valid progress event is sent once to the live window only; an invalid one is dropped with a warning and never throws', () => {
    const { progress, log } = setup()
    const listener = progress()
    expect(listener).not.toBeNull()
    const valid: RoutingProgressEvent = {
      refreshId: REFRESH_ID,
      model: SLUG,
      at: AT,
      stage: 'endpoints',
      fetchedAt: AT,
      endpointRows: 33,
      tags: 32,
      rejectedRows: 0
    }
    listener!(valid)
    const [live, destroyed] = windows.list
    expect(live.webContents.send).toHaveBeenCalledTimes(1)
    expect(live.webContents.send).toHaveBeenCalledWith('routing:progress', valid)
    expect(destroyed.webContents.send).not.toHaveBeenCalled()

    const invalid = { ...valid, stage: 'other' } as unknown as RoutingProgressEvent
    expect(() => listener!(invalid)).not.toThrow()
    expect(live.webContents.send).toHaveBeenCalledTimes(1)
    expect(log.warn).toHaveBeenCalledWith('progress event did not validate; not sent')

    // A window whose send throws does not make the listener throw, and the others still get the event.
    windows.list = [
      { isDestroyed: () => false, webContents: { send: vi.fn(() => { throw new Error('gone') }) } },
      live
    ]
    expect(() => listener!(valid)).not.toThrow()
    expect(live.webContents.send).toHaveBeenCalledTimes(2)
  })

  it("I8 (review): a failed event's message is scrubbed again before it is sent", () => {
    const { progress } = setup()
    const failed: RoutingProgressEvent = {
      refreshId: REFRESH_ID,
      model: SLUG,
      at: AT,
      stage: 'failed',
      code: 'FETCH_FAILED',
      failure: 'provider-error',
      message: 'upstream said ' + FAKE_KEY,
      spentUsd: 0
    }
    progress()!(failed)
    const [live, destroyed] = windows.list
    expect(live.webContents.send).toHaveBeenCalledTimes(1)
    expect(live.webContents.send).toHaveBeenCalledWith('routing:progress', { ...failed, message: 'upstream said [redacted]' })
    expect(JSON.stringify(live.webContents.send.mock.calls)).not.toContain(FAKE_KEY)
    expect(destroyed.webContents.send).not.toHaveBeenCalled()
  })

  it('I9: the preload bridges every channel with a string literal, as RoutingApi, and imports no Zod', () => {
    const preload = readFileSync(join(__dirname, '../../preload/index.ts'), 'utf8')
    for (const channel of Object.values(ROUTING_CHANNELS)) expect(preload, channel).toContain(`'${channel}'`)
    expect(preload).toContain('as RoutingApi')
    expect(preload).toContain("import type { RoutingApi } from '../shared/routing'")
    expect(preload).not.toContain("from 'zod'")
    // Only TYPES come from shared/routing: a value import would bundle its Zod schemas into the preload.
    // Every line naming the module must start with `import type` (so a multi-line import's closing
    // `} from '../shared/routing'` line fails too, conservatively).
    const routingImports = preload.split(/\r?\n/).filter((line) => /from\s+['"]\.\.\/shared\/routing['"]/.test(line))
    expect(routingImports.length).toBeGreaterThan(0)
    for (const line of routingImports) expect(line.trimStart().startsWith('import type '), line).toBe(true)
  })

  it('I10: every ok response survives a JSON round trip unchanged (plain JSON across the bridge)', async () => {
    const { responses } = await happyPaths()
    for (const { channel, response } of responses) {
      expect((response as { ok: boolean }).ok, channel).toBe(true)
      expect(JSON.parse(JSON.stringify(response)), channel).toStrictEqual(response)
    }
  })

  it('I11: an invalid credentials output (a non-UUID id) is OPERATION_FAILED with a count-only warning', async () => {
    const { service, log } = setup()
    service.credentials.mockImplementationOnce(() => ({ credentials: [{ id: 'x', label: 'L', providerName: 'P' }] }))
    const response = await call('routing:credentials', {})
    expect(response).toEqual({ ok: false, code: 'OPERATION_FAILED', message: 'Routing operation failed.' })
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn).toHaveBeenCalledWith('routing:credentials produced an invalid response (1 issues)')
    expect(log.error).not.toHaveBeenCalled()
  })

  it('I12: an invalid launch-preferences output (an unknown choice) is OPERATION_FAILED with a count-only warning', async () => {
    const { service, log } = setup()
    service.launchPreferences.mockImplementationOnce(() => ({ lastChoiceByModel: { [SLUG]: 'turbo' } }))
    const response = await call('routing:launch-preferences', {})
    expect(response).toEqual({ ok: false, code: 'OPERATION_FAILED', message: 'Routing operation failed.' })
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn).toHaveBeenCalledWith('routing:launch-preferences produced an invalid response (1 issues)')
    expect(log.error).not.toHaveBeenCalled()
  })
})
