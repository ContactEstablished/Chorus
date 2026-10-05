import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PtyLaunchSpec } from '../adapters/types'

/**
 * The exit fan-out must reach EVERY listener, whatever an earlier one does.
 *
 * Measured 2026-10-04 on a copy of a real profile: a credentialed OpenCode
 * session was killed from the UI, its `dispatches` row closed (3a-1's listener
 * ran) — and its minted OpenRouter key was neither read nor revoked, with not
 * one `[attribution]` line in the log, until the next boot's reconcile.
 *
 * The chain this file pins: node-pty's conpty agent can fire `onExit` with
 * `exitCode: undefined` on a kill (its socket closes before the native exit
 * callback sets the code; the installed DB holds 12 OpenCode kills with a NULL
 * exit_code and none for any other agent). The renderer forwarder
 * (`ipc.ts`, `sessionExitEventSchema.parse`) throws on that, and it is
 * registered BEFORE 3a-3's settle listener — so a bare fan-out loop stopped
 * there and `settleDispatch` was never called.
 *
 * No network and no key: the key client and the storage are fakes, and the
 * "hash" is a label, not key material.
 */

vi.mock('node-pty', () => ({ spawn: vi.fn() }))
vi.mock('../adapters/registry', () => ({
  getAdapterOrThrow: () => ({
    id: 'opencode',
    executionMode: 'pty',
    requiredEnvVars: [],
    getCapabilities: () => ({ hooks: null, instructions: null, sessionResume: null }),
    buildLaunch: (spec: PtyLaunchSpec) => ({
      executable: 'fixture.exe',
      args: [],
      cwd: spec.cwd,
      envAdditions: {},
      secretEnv: {}
    })
  })
}))

import * as pty from 'node-pty'
import { SessionManager } from './sessionManager'
import { DispatchAttribution } from './dispatchAttribution'
import { logger } from './logger'
import type { OpenRouterKeyClient } from './openrouterKeys'
import { sessionExitEventSchema } from '../../shared/ipc'

type AttributionDeps = ConstructorParameters<typeof DispatchAttribution>[0]
type ExitCallback = (e: { exitCode: number; signal?: number }) => void

const HASH = 'fixture-' + 'minted-hash'
const launchSecretEnv = { FIXTURE_SECRET: 'fixture' }

let exitCallback: ExitCallback | null = null

function fakeChild(): pty.IPty {
  return {
    pid: 1234,
    onData: vi.fn(),
    onExit: vi.fn((cb: ExitCallback) => {
      exitCallback = cb
      return { dispose: () => undefined }
    }),
    kill: vi.fn(),
    write: vi.fn(),
    resize: vi.fn()
  } as unknown as pty.IPty
}

/** A minted, linked, not-yet-revoked row — exactly what 3a-3's `linkDispatch`
 *  leaves behind and what session A's row looked like after the kill. */
function mintedRow(sessionId: string) {
  return {
    id: 'dispatch-1',
    sessionId,
    authMode: 'api_key',
    cwd: 'C:\\fixture',
    startedAt: '2026-10-04T21:04:13.000Z',
    endedAt: '2026-10-04T21:10:20.000Z',
    outcome: 'abandoned',
    closedBy: 'kill',
    mintedKeyHash: HASH,
    mintedKeyLimit: 1,
    mintedAt: '2026-10-04T21:04:13.000Z',
    revokedAt: null,
    attributionState: 'minted'
  }
}

function harness(sessionId: string) {
  const calls: string[] = []
  const keys = {
    readUsage: vi.fn(async (hash: string) => {
      calls.push(`readUsage:${hash}`)
      return { ok: true as const, value: { usageUsd: 0.016, limitRemaining: 0.984 } }
    }),
    queryTokens: vi.fn(async () => ({ ok: true as const, value: null })),
    revoke: vi.fn(async (hash: string) => {
      calls.push(`revoke:${hash}`)
      return { ok: true as const, value: undefined }
    }),
    mint: vi.fn(),
    list: vi.fn(),
    queryGatewayTotal: vi.fn(),
    queryKeyCost: vi.fn(),
    meta: vi.fn()
  }
  const storage = {
    getLatestDispatchForSession: vi.fn((id: string) => (id === sessionId ? mintedRow(id) : null)),
    settleDispatchAttribution: vi.fn()
  }
  const attribution = new DispatchAttribution({
    storage: storage as unknown as AttributionDeps['storage'],
    keys: keys as unknown as OpenRouterKeyClient,
    meter: { meter: () => null },
    hasManagementKey: () => true
  })
  return { keys, storage, attribution, calls }
}

/** The two production listeners, in their production order (ipc.ts registers
 *  the renderer forwarder at ~5384 and the settle listener at ~5774, both on
 *  the same Set). The forwarder's broadcast is omitted; its Zod parse is the
 *  real schema. */
function wireProductionOrder(manager: SessionManager, attribution: DispatchAttribution): void {
  manager.onExit((sessionId, exitCode) => {
    sessionExitEventSchema.parse({ sessionId, exitCode })
  })
  manager.onExit((sessionId) => {
    void attribution.settleDispatch(sessionId)
  })
}

function fireExit(exitCode: number | undefined): unknown {
  expect(exitCallback, 'the PTY exit callback was never registered').not.toBeNull()
  try {
    exitCallback!({ exitCode: exitCode as number })
    return null
  } catch (err) {
    return err
  }
}

describe('SessionManager exit fan-out reaches every listener', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    exitCallback = null
    vi.mocked(pty.spawn).mockReset()
    vi.mocked(pty.spawn).mockReturnValue(fakeChild())
  })

  it('control: a killed session with a numeric exit code reads, then revokes, its minted key', async () => {
    const { keys, storage, attribution, calls } = harness('s-control')
    const manager = new SessionManager()
    wireProductionOrder(manager, attribution)
    manager.launch('opencode', 'C:\\fixture', 's-control', { launchSecretEnv })
    manager.kill('s-control')

    expect(fireExit(-1073741510)).toBeNull()

    await vi.waitFor(() => expect(storage.settleDispatchAttribution).toHaveBeenCalledTimes(1))
    expect(calls).toStrictEqual([`readUsage:${HASH}`, `revoke:${HASH}`])
    expect(keys.revoke).toHaveBeenCalledWith(HASH)
    manager.dispose()
  })

  it('a killed OpenCode PTY that reports NO exit code still has its minted key read and revoked', async () => {
    const { keys, storage, attribution, calls } = harness('s-killed')
    const manager = new SessionManager()
    wireProductionOrder(manager, attribution)
    manager.launch('opencode', 'C:\\fixture', 's-killed', { launchSecretEnv })
    manager.kill('s-killed')

    // node-pty's runtime value on the conpty kill race — typed `number`, is not.
    const escaped = fireExit(undefined)

    await vi.waitFor(() => expect(keys.revoke).toHaveBeenCalledWith(HASH), { timeout: 1000 })
    expect(calls).toStrictEqual([`readUsage:${HASH}`, `revoke:${HASH}`])
    await vi.waitFor(() => expect(storage.settleDispatchAttribution).toHaveBeenCalledTimes(1))
    const patch = storage.settleDispatchAttribution.mock.calls[0][0] as {
      dispatchId: string
      costUsd: number | null
      revokedAt: string | null
      attributionState: string
    }
    expect(patch.dispatchId).toBe('dispatch-1')
    expect(patch.costUsd).toBe(0.016)
    expect(patch.revokedAt).not.toBeNull()
    expect(patch.attributionState).toBe('closed')
    // And the forwarder's throw no longer escapes into node-pty's socket
    // callback as an uncaught main-process exception.
    expect(escaped).toBeNull()
    manager.dispose()
  })

  it('a throwing listener is logged and every listener after it still runs', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const manager = new SessionManager()
    const reached: string[] = []
    manager.onExit(() => reached.push('first'))
    manager.onExit(() => {
      throw new Error('fixture listener failure')
    })
    manager.onExit(() => reached.push('third'))
    manager.onExit(() => reached.push('fourth'))
    manager.launch('opencode', 'C:\\fixture', 's-throw', { launchSecretEnv })

    expect(fireExit(0)).toBeNull()
    expect(reached).toStrictEqual(['first', 'third', 'fourth'])
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(String(errorSpy.mock.calls[0][1])).toContain('s-throw')
    manager.dispose()
  })
})
