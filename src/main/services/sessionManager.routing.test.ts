import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PtyLaunchSpec } from '../adapters/types'

/**
 * Model Routing Task 4a-3, Table SM (ImplementationSpec-4a-3): `LaunchOptions.routing` is carried
 * straight through to the adapter's PtyLaunchSpec, and its content reaches the child only through
 * the adapter's own envAdditions (MR-D3: per process, never argv, never the shared file). A launch
 * without it — restore and session:restart pass no options — carries none. And a launch profile's
 * env that sets OPENCODE_CONFIG_CONTENT beats the adapter's addition here, which is exactly why main
 * refuses that routed launch (K7) instead of relying on this precedence.
 *
 * The adapter is a fixture shaped like opencode's: its buildLaunch records the spec it was given and
 * declares OPENCODE_CONFIG_CONTENT from `spec.routing`, as opencode.ts does. Every launch but SM4
 * passes `launchSecretEnv`, so composeChildEnv takes its allow-list branch and no ambient variable
 * (an OPENCODE_CONFIG_CONTENT in the developer's own environment included) can leak into the env.
 */

const { specs } = vi.hoisted(() => ({ specs: [] as PtyLaunchSpec[] }))

vi.mock('node-pty', () => ({ spawn: vi.fn() }))
vi.mock('../adapters/registry', () => ({
  getAdapterOrThrow: () => ({
    id: 'opencode',
    executionMode: 'pty',
    requiredEnvVars: [],
    getCapabilities: () => ({ hooks: null, instructions: null, sessionResume: null }),
    buildLaunch: (spec: PtyLaunchSpec) => {
      specs.push(spec)
      return {
        executable: 'fixture.exe',
        args: [],
        cwd: spec.cwd,
        envAdditions: spec.routing ? { OPENCODE_CONFIG_CONTENT: spec.routing.configContent } : {},
        secretEnv: {}
      }
    }
  })
}))

import * as pty from 'node-pty'
import { SessionManager } from './sessionManager'

const X = '{"provider":{"openrouter":{"models":{}}}}'
const launchSecretEnv = { FIXTURE_SECRET: 'fixture' }

function fakeChild(): pty.IPty {
  return { pid: 1234, onData: vi.fn(), onExit: vi.fn(), kill: vi.fn(), write: vi.fn(), resize: vi.fn() } as unknown as pty.IPty
}

/** The env block the (mocked) node-pty spawn received on its latest call. */
function spawnedEnv(): Record<string, string> {
  const options = vi.mocked(pty.spawn).mock.calls.at(-1)?.[2]
  expect(options, 'pty.spawn was not called').toBeDefined()
  return options!.env as Record<string, string>
}

describe('LaunchOptions.routing reaches the spec and the child env (Model Routing 4a-3, Table SM)', () => {
  beforeEach(() => {
    specs.length = 0
    vi.mocked(pty.spawn).mockReset()
    vi.mocked(pty.spawn).mockReturnValue(fakeChild())
  })

  it("SM1: a routed launch's content reaches PtyLaunchSpec.routing unchanged and the child as OPENCODE_CONFIG_CONTENT", () => {
    const manager = new SessionManager()
    manager.launch('opencode', 'C:\\fixture', 'routed', { routing: { configContent: X }, launchSecretEnv })
    expect(specs).toHaveLength(1)
    expect(specs[0].routing).toStrictEqual({ configContent: X })
    expect(spawnedEnv().OPENCODE_CONFIG_CONTENT).toBe(X)
    manager.dispose()
  })

  it('SM2: without routing the spec carries none and the env has no OPENCODE_CONFIG_CONTENT', () => {
    const manager = new SessionManager()
    manager.launch('opencode', 'C:\\fixture', 'routed', { launchSecretEnv })
    expect(specs).toHaveLength(1)
    expect(specs[0].routing).toBeUndefined()
    expect(spawnedEnv()).not.toHaveProperty('OPENCODE_CONFIG_CONTENT')
    manager.dispose()
  })

  it("SM3: a profile env that sets OPENCODE_CONFIG_CONTENT beats the adapter's addition — why main refuses that routed launch (K7)", () => {
    const manager = new SessionManager()
    manager.launch('opencode', 'C:\\fixture', 'routed', {
      routing: { configContent: X },
      envAdditions: { OPENCODE_CONFIG_CONTENT: 'profile' },
      launchSecretEnv
    })
    expect(specs).toHaveLength(1)
    expect(spawnedEnv().OPENCODE_CONFIG_CONTENT).toBe('profile')
    manager.dispose()
  })

  it('SM4: a restore-shaped launch (no options at all) passes no routing', () => {
    const manager = new SessionManager()
    manager.launch('opencode', 'C:\\fixture', 'restored')
    expect(specs).toHaveLength(1)
    expect(specs[0].routing).toBeUndefined()
    manager.dispose()
  })
})
