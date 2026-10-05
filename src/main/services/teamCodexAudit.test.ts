import { describe, expect, it } from 'vitest'
import { summarizeCodexPilotTranscript } from '../../../scripts/team-codex-audit'

const id = 'a'.repeat(8) + '-aaaa-aaaa-aaaa-' + 'a'.repeat(12), session = 'pane-id', cwd = process.cwd()
const row = (type: string, payload: unknown) => JSON.stringify({ type, payload, timestamp: '2026-09-30T22:00:00Z' })
const meta = row('session_meta', { id, cwd, originator: `chorus-${session}` })
const usage = { input_tokens: 100, cached_input_tokens: 80, output_tokens: 20, reasoning_output_tokens: 15, total_tokens: 120 }
const record = row('token_usage_record', { response_id: 'response-1', thread_id: id, usage, thread_token_usage: usage })
const audit = (lines: string[]) => summarizeCodexPilotTranscript(lines.join('\n'), id, cwd, session)
describe('benchmark-only native Codex accounting', () => {
  it('distinguishes a blocked native turn from successful fixture completion and a new active turn', () => {
    const blocked = row('event_msg', { type: 'task_complete', last_agent_message: 'Blocked before delegation.' })
    const result = audit([meta, record, blocked])
    expect(result.lastTurnCompleted).toBe(true)
    expect(result.completed).toBe(false)
    expect(audit([meta, record, blocked, row('event_msg', { type: 'task_started' })]).lastTurnCompleted).toBe(false)
    expect(audit([blocked]).lastTurnCompleted).toBe(false)
  })
  it('deduplicates native requests and keeps cached input/reasoning as subsets', () => {
    const result = audit([meta, row('turn_context', { model: 'gpt-6-astra', effort: 'medium' }), record, record])
    expect(result.usage).toMatchObject({ inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadTokens: 80, reasoningOutputTokens: 15 })
    expect(result.modelRequests).toBe(1); expect(result.coverage).toBe('verified-thread')
    expect(result.apiEquivalentUsd.low).toBeCloseTo(.00128)
    expect(result.apiEquivalentUsd.high).toBeCloseTo(.00133)
  })
  it('refuses another pane, conversation or worktree even when the usage looks valid', () => {
    for (const payload of [{ id, cwd, originator: 'another-pane' }, { id: 'other', cwd, originator: `chorus-${session}` }, { id, cwd: cwd + '/other', originator: `chorus-${session}` }]) {
      expect(audit([row('session_meta', payload), record]).identityVerified).toBe(false)
      expect(audit([row('session_meta', payload), record]).usage).toBeNull()
    }
  })
  it('retains partial/missing accounting and rejects wrong-thread counters', () => {
    expect(audit([meta]).coverage).toBe('partial')
    expect(audit([meta, record, row('event_msg', { type: 'token_count', info: { total_token_usage: { total_tokens: 999 } } })]).coverage).toBe('partial')
    expect(audit([meta, row('token_usage_record', { response_id: 'other', thread_id: 'other', usage })]).usage).toBeNull()
    expect(audit([meta, record, '{broken']).apiEquivalentUsd).toBeNull()
    expect(audit([meta, row('token_usage_record', { response_id: 'bad', usage: { ...usage, cached_input_tokens: 101 } })]).usage).toBeNull()
  })
  it('counts unique native call containers and only trusts the assistant completion marker', () => {
    const call = row('response_item', { type: 'custom_tool_call', call_id: 'call-1', name: 'functions.exec', input: 'await tools.mcp__chorus_team__team_wait({timeoutMs:900000})' })
    const result = audit([meta, record, call, call, row('response_item', { type: 'message', role: 'user', content: [{ text: 'PILOT_COMPLETE' }] })])
    expect(result.toolCalls).toBe(1); expect(result.completed).toBe(false)
    expect(result.buckets).toEqual([{ category: 'waiting', toolCalls: 1 }])
    expect(audit([meta, record, row('response_item', { type: 'message', role: 'assistant', phase: 'commentary', content: [{ text: 'PILOT_COMPLETE' }] })]).completed).toBe(false)
    expect(audit([meta, record, row('response_item', { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ text: 'PILOT_COMPLETE' }] }), row('event_msg', { type: 'task_complete', last_agent_message: 'PILOT_COMPLETE' })]).completed).toBe(true)
  })
  it('rejects conflicting duplicate counters and impossible subset values', () => {
    const changed = row('token_usage_record', { response_id: 'response-1', thread_id: id, usage: { ...usage, input_tokens: 101, total_tokens: 121 } })
    expect(audit([meta, record, changed]).coverage).toBe('partial')
    for (const counter of [{ reasoning_output_tokens: -1 }, { cached_input_tokens: 1.5 }, { cache_write_input_tokens: 21 }]) {
      expect(audit([meta, row('token_usage_record', { response_id: 'bad', usage: { ...usage, ...counter } })]).usage).toBeNull()
    }
    expect(audit([meta, record, row('event_msg', { type: 'token_count', info: { total_token_usage: { total_tokens: 120, input_tokens: 99, output_tokens: 21 } } })]).coverage).toBe('partial')
  })
})
