import { describe, expect, it, vi } from 'vitest'
vi.mock('node-pty', () => ({ spawn: vi.fn() }))
vi.mock('../adapters/registry', () => ({ getAdapterOrThrow: () => ({ id: 'claude', executionMode: 'pty', requiredEnvVars: [], getCapabilities: () => ({ hooks: null, instructions: null, sessionResume: null }), buildLaunch: ({ cwd }: { cwd: string }) => ({ executable: 'fixture.exe', args: ['baseline'], cwd, envAdditions: {}, secretEnv: {} }) }) }))
import * as pty from 'node-pty'
import { SessionManager } from './sessionManager'
import type { StorageService } from './storage'

describe('team lead ordinary restore exclusion', () => {
  it('refuses ordinary launch of an owned lead before any process effect', () => {
    const manager = new SessionManager(); manager.bindRestoreExclusion(() => true)
    expect(() => manager.launch('claude', 'C:\\fixture', 'owned')).toThrow('Team Resume')
    expect(pty.spawn).not.toHaveBeenCalled(); manager.dispose()
  })
  it('passes verified main-only Team arguments and secret env with a final spawn fence', () => {
    vi.stubEnv('OPENAI_API_KEY', 'ambient-must-not-leak')
    const child = { pid: 1234, onData: vi.fn(), onExit: vi.fn(), kill: vi.fn(), write: vi.fn(), resize: vi.fn() }
    vi.mocked(pty.spawn).mockReturnValue(child as unknown as pty.IPty)
    const manager = new SessionManager(), authorize = vi.fn()
    manager.launch('claude', 'C:\\fixture', 'session', { teamLaunchArgs: ['--mcp-config', 'C:\\external\\team.json', '--model', 'sonnet'], launchSecretEnv: { CHORUS_TEAM_TOKEN: 'fixture-run-token' }, authorizeSpawn: authorize })
    expect(pty.spawn).toHaveBeenCalledWith('fixture.exe', ['baseline', '--mcp-config', 'C:\\external\\team.json', '--model', 'sonnet'], expect.objectContaining({ env: expect.objectContaining({ CHORUS_TEAM_TOKEN: 'fixture-run-token' }) }))
    expect(vi.mocked(pty.spawn).mock.calls.at(-1)![2]?.env).not.toHaveProperty('OPENAI_API_KEY')
    expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(pty.spawn).mock.invocationCallOrder.at(-1)!)
    expect(manager.ownedPtyPid('session')).toBe(1234)
    manager.dispose(); vi.unstubAllEnvs(); vi.mocked(pty.spawn).mockClear()
  })
  it('does not spawn when final authority or required instructions are unavailable', () => {
    const manager = new SessionManager()
    expect(() => manager.launch('claude', 'C:\\fixture', 'revoked', { authorizeSpawn: () => { throw Error('revoked') } })).toThrow('revoked')
    expect(() => manager.launch('claude', 'C:\\fixture', 'instructions', { requireInstructions: true, instructions: 'CHORUS TEAM SESSION' })).toThrow('instructions')
    expect(pty.spawn).not.toHaveBeenCalled(); manager.dispose()
  })
  it('excludes subscription team leads before planning, healing or spawning', async () => {
    const storage = {
      getPaneLayout: () => ({ version: 1, root: { type: 'leaf', sessionId: 'team-leaf' } }),
      getSessionsForProject: () => [{ id: 'team-leaf', status: 'running', agent: 'claude' }, { id: 'team-orphan', status: 'running', agent: 'codex' }, { id: 'ordinary-orphan', status: 'running', agent: 'codex', exitCode: null }],
      getCredentialedSessionIds: () => new Set<string>(), updateSessionStatus: vi.fn(), updateSessionTitle: vi.fn()
    }
    const manager = new SessionManager(); manager.bindStorage(storage as unknown as StorageService)
    manager.bindRestoreExclusion(id => id.startsWith('team-'))
    expect(manager.planRestoreCount('project')).toBe(0)
    await manager.restore('project')
    expect(storage.updateSessionStatus.mock.calls).toEqual([['ordinary-orphan', 'exited', null]])
    expect(pty.spawn).not.toHaveBeenCalled(); expect(storage.updateSessionTitle).not.toHaveBeenCalled()
    manager.dispose()
  })
})
