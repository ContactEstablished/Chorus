import { describe, expect, it, vi } from 'vitest'
import { composeHelperEnv, MAX_HELPER_RECORD_BYTES } from './common'
import { createHelperParser } from './parser'
import { helperRegistry, getHelperAdapter } from './registry'
import type { HelperEvent, HelperExecutionInput } from './types'
import { verifiedHelperCombination } from './evidence'

vi.mock('../../services/cliDetect', () => ({ resolveCli: vi.fn((id: string) => ({ file: `C:\\Program Files\\${id}.exe`, args: [], path: id })) }))
const input = (overrides: Partial<HelperExecutionInput> = {}): HelperExecutionInput => ({
  attemptId: 'attempt-1', cwd: 'C:\\fixture space', kind: 'code', model: 'test-model',
  brief: 'Fix the fixture. Literal shell text: $(never) & "quoted".', signal: new AbortController().signal,
  windowsSandbox: 'elevated', ...overrides
})
const line = (event: unknown) => JSON.stringify(event) + '\n'
const completion = { type: 'result', subtype: 'success', is_error: false, result: 'Done 🟢', usage: { input_tokens: 2, output_tokens: 3 }, total_cost_usd: 0.01 }

describe('structured helper launch boundaries', () => {
  it('requires the measured version/model/auth combination, not a catalog entry', () => {
    const native = { id: 'codex' as const, version: 'codex-cli 0.155.1', authMode: 'subscription' as const, model: 'gpt-6-astra' }
    expect(verifiedHelperCombination(native)).toBe(true)
    expect(verifiedHelperCombination({ ...native, version: 'codex-cli 0.156.0' })).toBe(false)
    expect(verifiedHelperCombination({ ...native, model: 'gpt-5.6' })).toBe(false)
    expect(verifiedHelperCombination({ ...native, authMode: 'api_key', baseUrl: 'https://api.openai.com/v1' })).toBe(false)
  })
  it('keeps prompts exclusively on stdin and never uses bypass flags', () => {
    for (const id of ['claude', 'codex'] as const) {
      const request = helperRegistry[id].buildExecution(input())
      expect(request.stdin).toContain('$(never)')
      expect(request.args.join(' ')).not.toContain('$(never)')
      expect(request.args.join(' ')).not.toMatch(/bypass|danger-full-access|skip-permissions/)
      expect(request.executable).toContain('Program Files')
    }
  })
  it('uses explicit native analysis restrictions', () => {
    const claude = helperRegistry.claude.buildExecution(input({ kind: 'analysis', allowedCommands: ['node --test'] }))
    expect(claude.args[claude.args.indexOf('--tools') + 1]).toBe('Read,Glob,Grep')
    expect(claude.args).not.toContain('--allowedTools')
    const codex = helperRegistry.codex.buildExecution(input({ kind: 'analysis' }))
    expect(codex.args).toContain('read-only')
    expect(codex.args).toContain('multi_agent')
  })
  it('pins Codex sandbox selection and rejects an absent selection on Windows', () => {
    expect(helperRegistry.codex.buildExecution(input()).args).toContain('windows.sandbox="elevated"')
    if (process.platform === 'win32') expect(() => helperRegistry.codex.buildExecution(input({ windowsSandbox: undefined }))).toThrow(/sandbox/)
  })
  it('isolates subscription and API environment from lead/ambient authorization', () => {
    const parent = { Path: 'selected-path', SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\User', ANTHROPIC_API_KEY: 'ambient', OPENAI_API_KEY: 'ambient-two', CHORUS_TEAM_TOKEN: 'lead-token', NODE_OPTIONS: '--require bad', CLAUDE_CODE_SESSION_ID: 'parent' }
    const env = composeHelperEnv(parent, { envAdditions: {}, secretEnv: {} })
    expect(env.Path).toBe('selected-path')
    expect(env.PATHEXT).toContain('.EXE')
    for (const name of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CHORUS_TEAM_TOKEN', 'NODE_OPTIONS', 'CLAUDE_CODE_SESSION_ID']) expect(env[name]).toBeUndefined()
    expect(composeHelperEnv(parent, { envAdditions: {}, secretEnv: { OPENAI_API_KEY: 'selected' } }).OPENAI_API_KEY).toBe('selected')
    expect(() => composeHelperEnv(parent, { envAdditions: { CHORUS_TEAM_TOKEN: 'bad' }, secretEnv: {} })).toThrow()
    expect(() => composeHelperEnv(parent, { envAdditions: {}, secretEnv: { PATH: 'bad' } })).toThrow()
  })
  it('keeps selected API credentials out of argv/config and refuses route fallback', () => {
    const credential = { envVarName: 'OPENROUTER_API_KEY', value: 'private-test-value', isSecret: true as const }
    const route = { providerKey: 'selected', providerName: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', modelId: 'z-ai/glm-5.3' }
    const launch = helperRegistry.opencode.buildExecution(input({ model: 'z-ai/glm-5.3', credential, route, allowedCommands: ['node --test'] }))
    expect(launch.args).toContain('openrouter/z-ai/glm-5.3')
    expect(JSON.stringify([launch.args, launch.envAdditions])).not.toContain(credential.value)
    expect(launch.secretEnv.OPENROUTER_API_KEY).toBe(credential.value)
    expect(JSON.parse(launch.envAdditions.OPENCODE_CONFIG_CONTENT).permission.task).toBe('deny')
    expect(() => helperRegistry.opencode.buildExecution(input({ credential, route: { ...route, baseUrl: 'https://example.org' } }))).toThrow(/route/)
    expect(() => helperRegistry.codex.buildExecution(input({ route }))).toThrow(/ambient/)
  })
  it('declares custom models in ephemeral OpenCode config and keeps role instructions on stdin', () => {
    for (const model of ['vendor/custom:free', 'openrouter/auto']) {
      const launch = helperRegistry.opencode.buildExecution(input({ model, roleInstructions: 'Check accessibility.', kind: 'analysis', credential: { envVarName: 'OPENROUTER_API_KEY', value: 'fixture-only', isSecret: true }, route: { providerKey: 'openrouter', providerName: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', modelId: model } }))
      expect(launch.args).toContain(`openrouter/${model}`)
      expect(JSON.parse(launch.envAdditions.OPENCODE_CONFIG_CONTENT).provider.openrouter.models[model]).toEqual({})
      expect(JSON.parse(launch.envAdditions.OPENCODE_CONFIG_CONTENT).permission.edit).toBe('deny')
      expect(launch.stdin).toContain('Check accessibility.')
      expect(launch.args.join(' ')).not.toContain('Check accessibility.')
    }
  })
  it('rejects invalid bounds and respects cancellation before CLI resolution', () => {
    expect(() => helperRegistry.claude.buildExecution(input({ brief: '😀'.repeat(20000) }))).toThrow(/UTF-8/)
    expect(() => helperRegistry.claude.buildExecution(input({ cwd: 'relative' }))).toThrow(/absolute/)
    const controller = new AbortController(); controller.abort()
    expect(() => helperRegistry.claude.buildExecution(input({ signal: controller.signal }))).toThrow()
    expect(getHelperAdapter('__proto__')).toBeUndefined()
  })
})

describe('helper event normalization', () => {
  it('preserves split UTF-8 and parses multiple JSONL records', () => {
    const parser = createHelperParser('claude')
    const bytes = Buffer.from(line({ type: 'system', subtype: 'init', session_id: 'vendor' }) + line(completion))
    const events: HelperEvent[] = []
    for (const byte of bytes) events.push(...parser.push(Buffer.from([byte])))
    events.push(...parser.finish())
    expect(events.find(e => e.type === 'result')).toEqual({ type: 'result', summary: 'Done 🟢', isError: false })
    expect(events.find(e => e.type === 'usage')).toMatchObject({ usage: { costKind: 'list-price-estimate' } })
  })
  it('rejects malformed/oversized/missing/duplicate completion rather than guessing from exit', () => {
    const malformed = createHelperParser('claude')
    expect(malformed.push('not json\n')[0].type).toBe('protocol-error')
    const huge = createHelperParser('claude')
    expect(huge.push('a'.repeat(MAX_HELPER_RECORD_BYTES + 1))[0].type).toBe('protocol-error')
    const missing = createHelperParser('codex')
    missing.push(line({ type: 'turn.started' }))
    expect(missing.finish()[0].type).toBe('protocol-error')
    const duplicate = createHelperParser('claude')
    expect(duplicate.push(line(completion) + line(completion)).at(-1)?.type).toBe('protocol-error')
  })
  it('surfaces structured Claude denials despite success subtype', () => {
    const events = createHelperParser('claude').push(line({ ...completion, permission_denials: [{ tool_name: 'Bash' }] }))
    expect(events).toContainEqual({ type: 'permission-blocked', reason: 'Claude reported denied tool calls.' })
    expect(events.at(-1)).toMatchObject({ type: 'result', isError: true })
  })
  it('retains native disabled-tool denials through an otherwise successful final message', () => {
    const claude = createHelperParser('claude')
    expect(claude.push(line({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: '<tool_use_error>Error: No such tool available: Edit. Edit is disabled for this session, in subagents as well as here.</tool_use_error>' }] } }))[0].type).toBe('permission-blocked')
    expect(claude.push(line(completion)).at(-1)).toMatchObject({ type: 'result', isError: true })
    const opencode = createHelperParser('opencode')
    expect(opencode.push(line({ type: 'tool_use', part: { state: { status: 'error', error: 'The user has specified a rule which prevents you from using this specific tool call.' } } }))[0].type).toBe('permission-blocked')
    opencode.push(line({ type: 'text', part: { text: 'Could not edit.' } }))
    expect(opencode.push(line({ type: 'step_finish', part: { reason: 'stop' } })).at(-1)).toMatchObject({ type: 'result', isError: true })
  })
  it('preserves Codex final evidence and usage without claiming acceptance', () => {
    const parser = createHelperParser('codex')
    expect(parser.push(line({ type: 'new.informational.event' }))).toEqual([])
    parser.push(line({ type: 'item.completed', item: { type: 'agent_message', text: 'The operation was blocked.' } }))
    const events = parser.push(line({ type: 'turn.completed', usage: { input_tokens: 4, cached_input_tokens: 3, output_tokens: 2 } }))
    expect(events.at(-1)).toEqual({ type: 'result', summary: 'The operation was blocked.', isError: false })
    expect(events[0]).toMatchObject({ usage: { costUsd: null, source: 'codex-turn' } })
  })
  it('distinguishes opencode intermediate steps from final completion', () => {
    const parser = createHelperParser('opencode')
    const first = parser.push(line({ type: 'step_finish', sessionID: 's', part: { reason: 'tool-calls', tokens: { input: 2, output: 1 }, cost: 0.001 } }))
    expect(first.some(e => e.type === 'result')).toBe(false)
    parser.push(line({ type: 'text', part: { text: 'One real test passed.' } }))
    expect(parser.push(line({ type: 'step_finish', part: { reason: 'stop' } }))).toContainEqual({ type: 'result', summary: 'One real test passed.', isError: false })
    expect(parser.finish()).toEqual([])
  })
})
